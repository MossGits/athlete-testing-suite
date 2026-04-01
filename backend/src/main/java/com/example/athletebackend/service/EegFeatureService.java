package com.example.athletebackend.service;

import com.example.athletebackend.model.SessionFile;
import com.example.athletebackend.repo.SessionFileRepo;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

@Service
public class EegFeatureService {

    private static final List<String> EEG_KINDS = List.of(
            "EEG_GONOGO",
            "EEG_ONEBACK",
            "EEG_POSTURALBOTH",
            "EEG_POSTURALLEFT",
            "EEG_POSTURALRIGHT"
    );

    private static final Map<String, double[]> EEG_BANDS = new LinkedHashMap<>();
    static {
        EEG_BANDS.put("delta", new double[]{0.0, 4.0});
        EEG_BANDS.put("theta", new double[]{4.0, 7.0});
        EEG_BANDS.put("alpha", new double[]{8.0, 13.0});
        EEG_BANDS.put("beta",  new double[]{13.0, 30.0});
        EEG_BANDS.put("gamma", new double[]{30.0, 45.0});
    }

    private final SessionFileRepo files;
    private final ObjectMapper objectMapper;

    public EegFeatureService(SessionFileRepo files, ObjectMapper objectMapper) {
        this.files = files;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> processAndStore(UUID sessionId) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sessionId", sessionId.toString());

        Map<String, Object> eegFeatures = new LinkedHashMap<>();

        for (String kind : EEG_KINDS) {
            var maybeFile = files.findBySessionIdAndKind(sessionId, kind);
            if (maybeFile.isEmpty()) {
                eegFeatures.put(kind, Map.of(
                        "status", "missing",
                        "message", "No uploaded file found for this phase"
                ));
                continue;
            }

            try {
                PhaseFeatures features = processOnePhase(maybeFile.get());
                eegFeatures.put(kind, Map.of(
                        "status", "ok",
                        "delta", features.delta(),
                        "theta", features.theta(),
                        "alpha", features.alpha(),
                        "beta", features.beta(),
                        "gamma", features.gamma(),
                        "epochsUsed", features.epochsUsed(),
                        "sampleRateHz", features.sampleRateHz()
                ));
            } catch (Exception ex) {
                eegFeatures.put(kind, Map.of(
                        "status", "error",
                        "message", ex.getMessage()
                ));
            }
        }

        result.put("eegFeatures", eegFeatures);

        byte[] jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(result);
        byte[] gzBytes = gzip(jsonBytes);

        SessionFile stored = files.findBySessionIdAndKind(sessionId, "EEG_FEATURES")
                .orElseGet(SessionFile::new);

        stored.setSessionId(sessionId);
        stored.setKind("EEG_FEATURES");
        stored.setFilename("session_" + sessionId + "_EEG_FEATURES.json.gz");
        stored.setContentType("application/json");
        stored.setContentEncoding("gzip");
        stored.setSizeBytes((long) gzBytes.length);
        stored.setSha256(null);
        stored.setCreatedAt(OffsetDateTime.now());
        stored.setData(gzBytes);

        files.save(stored);

        return result;
    }

    public Map<String, Object> getStored(UUID sessionId) throws Exception {
        SessionFile sf = files.findBySessionIdAndKind(sessionId, "EEG_FEATURES")
                .orElseThrow(() -> new IllegalArgumentException("No processed EEG features found for this session"));

        byte[] raw = gunzip(sf.getData());
        return objectMapper.readValue(raw, Map.class);
    }

    private PhaseFeatures processOnePhase(SessionFile sf) throws Exception {
        ParsedEeg parsed = parseCsv(gunzip(sf.getData()));

        if (parsed.timestampsMs().length < 32) {
            throw new IllegalArgumentException("Not enough EEG samples");
        }

        double fs = estimateSampleRateHz(parsed.timestampsMs());
        if (!Double.isFinite(fs) || fs < 200.0 || fs > 300.0) {
            fs = 256.0;
        }

        double[][] channels = copy2d(parsed.channels());

        // 1-45 Hz bandpass, 4th-order Butterworth approximation via cascaded biquads
        for (int ch = 0; ch < channels.length; ch++) {
            channels[ch] = butterworthBandpass4(channels[ch], fs, 1.0, 45.0);
        }

        // common-average rereference: subtract mean across channels at each sample
        rereferenceCommonAverage(channels);

        int epochLength = (int) Math.round(2.0 * fs);
        if (epochLength < 8) {
            throw new IllegalArgumentException("Epoch length is too small");
        }

        int nSamples = channels[0].length;
        int nEpochs = nSamples / epochLength;
        if (nEpochs < 1) {
            throw new IllegalArgumentException("Not enough data for a 2-second EEG epoch");
        }

        List<Double> deltaVals = new ArrayList<>();
        List<Double> thetaVals = new ArrayList<>();
        List<Double> alphaVals = new ArrayList<>();
        List<Double> betaVals = new ArrayList<>();
        List<Double> gammaVals = new ArrayList<>();

        for (int e = 0; e < nEpochs; e++) {
            int start = e * epochLength;

            double[] epochAvg = new double[epochLength];
            for (int i = 0; i < epochLength; i++) {
                double sum = 0.0;
                for (double[] channel : channels) {
                    sum += channel[start + i];
                }
                epochAvg[i] = sum / channels.length;
            }

            double[] windowed = applyHann(epochAvg);
            PsdResult psd = computeOneSidedPsd(windowed, fs);

            double totalPower = integrateBand(psd.freqHz(), psd.power(), 0.0, 45.0);
            if (!Double.isFinite(totalPower) || totalPower <= 0.0) {
                continue;
            }

            deltaVals.add(integrateBand(psd.freqHz(), psd.power(), 0.0, 4.0) / totalPower);
            thetaVals.add(integrateBand(psd.freqHz(), psd.power(), 4.0, 7.0) / totalPower);
            alphaVals.add(integrateBand(psd.freqHz(), psd.power(), 8.0, 13.0) / totalPower);
            betaVals.add(integrateBand(psd.freqHz(), psd.power(), 13.0, 30.0) / totalPower);
            gammaVals.add(integrateBand(psd.freqHz(), psd.power(), 30.0, 45.0) / totalPower);
        }

        if (deltaVals.isEmpty()) {
            throw new IllegalArgumentException("Could not compute EEG spectral features");
        }

        return new PhaseFeatures(
                mean(deltaVals),
                mean(thetaVals),
                mean(alphaVals),
                mean(betaVals),
                mean(gammaVals),
                deltaVals.size(),
                fs
        );
    }

    private ParsedEeg parseCsv(byte[] rawCsv) throws Exception {
        List<Long> timestamps = new ArrayList<>();
        List<Double> tp9 = new ArrayList<>();
        List<Double> af7 = new ArrayList<>();
        List<Double> af8 = new ArrayList<>();
        List<Double> tp10 = new ArrayList<>();

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new ByteArrayInputStream(rawCsv), StandardCharsets.UTF_8))) {

            String header = br.readLine();
            if (header == null || header.isBlank()) {
                throw new IllegalArgumentException("CSV is empty");
            }

            String line;
            while ((line = br.readLine()) != null) {
                if (line.isBlank()) continue;

                String[] parts = line.split(",", -1);
                if (parts.length < 5) continue;

                timestamps.add(Long.parseLong(parts[0].trim()));
                tp9.add(parseDoubleSafe(parts[1]));
                af7.add(parseDoubleSafe(parts[2]));
                af8.add(parseDoubleSafe(parts[3]));
                tp10.add(parseDoubleSafe(parts[4]));
            }
        }

        if (timestamps.size() < 2) {
            throw new IllegalArgumentException("Not enough EEG samples in CSV");
        }

        return new ParsedEeg(
                timestamps.stream().mapToLong(Long::longValue).toArray(),
                new double[][]{
                        tp9.stream().mapToDouble(Double::doubleValue).toArray(),
                        af7.stream().mapToDouble(Double::doubleValue).toArray(),
                        af8.stream().mapToDouble(Double::doubleValue).toArray(),
                        tp10.stream().mapToDouble(Double::doubleValue).toArray()
                }
        );
    }

    private static double parseDoubleSafe(String s) {
        double v = Double.parseDouble(s.trim());
        if (!Double.isFinite(v)) return 0.0;
        return v;
    }

    private static double estimateSampleRateHz(long[] timestampsMs) {
        if (timestampsMs.length < 2) return Double.NaN;

        double totalDiff = 0.0;
        int count = 0;
        for (int i = 1; i < timestampsMs.length; i++) {
            long diff = timestampsMs[i] - timestampsMs[i - 1];
            if (diff > 0) {
                totalDiff += diff;
                count++;
            }
        }

        if (count == 0) return Double.NaN;
        double meanDtMs = totalDiff / count;
        return 1000.0 / meanDtMs;
    }

    private static void rereferenceCommonAverage(double[][] channels) {
        if (channels.length == 0 || channels[0].length == 0) return;

        int nSamples = channels[0].length;
        int nChannels = channels.length;

        for (int i = 0; i < nSamples; i++) {
            double m = 0.0;
            for (double[] channel : channels) {
                m += channel[i];
            }
            m /= nChannels;

            for (double[] channel : channels) {
                channel[i] -= m;
            }
        }
    }

    private static double[] butterworthBandpass4(double[] x, double fs, double lowHz, double highHz) {
        double[] y = Arrays.copyOf(x, x.length);

        // 4th-order Butterworth high-pass = 2 cascaded 2nd-order sections
        y = biquadHighPass(y, fs, lowHz, 0.5411961);
        y = biquadHighPass(y, fs, lowHz, 1.30656296);

        // 4th-order Butterworth low-pass = 2 cascaded 2nd-order sections
        y = biquadLowPass(y, fs, highHz, 0.5411961);
        y = biquadLowPass(y, fs, highHz, 1.30656296);

        return y;
    }

    private static double[] biquadLowPass(double[] x, double fs, double cutoffHz, double q) {
        double omega = 2.0 * Math.PI * cutoffHz / fs;
        double sin = Math.sin(omega);
        double cos = Math.cos(omega);
        double alpha = sin / (2.0 * q);

        double b0 = (1.0 - cos) / 2.0;
        double b1 = 1.0 - cos;
        double b2 = (1.0 - cos) / 2.0;
        double a0 = 1.0 + alpha;
        double a1 = -2.0 * cos;
        double a2 = 1.0 - alpha;

        return runBiquad(x, b0, b1, b2, a0, a1, a2);
    }

    private static double[] biquadHighPass(double[] x, double fs, double cutoffHz, double q) {
        double omega = 2.0 * Math.PI * cutoffHz / fs;
        double sin = Math.sin(omega);
        double cos = Math.cos(omega);
        double alpha = sin / (2.0 * q);

        double b0 = (1.0 + cos) / 2.0;
        double b1 = -(1.0 + cos);
        double b2 = (1.0 + cos) / 2.0;
        double a0 = 1.0 + alpha;
        double a1 = -2.0 * cos;
        double a2 = 1.0 - alpha;

        return runBiquad(x, b0, b1, b2, a0, a1, a2);
    }

    private static double[] runBiquad(double[] x, double b0, double b1, double b2, double a0, double a1, double a2) {
        double nb0 = b0 / a0;
        double nb1 = b1 / a0;
        double nb2 = b2 / a0;
        double na1 = a1 / a0;
        double na2 = a2 / a0;

        double[] y = new double[x.length];
        double x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0;

        for (int i = 0; i < x.length; i++) {
            double xn = x[i];
            double yn = nb0 * xn + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
            y[i] = yn;

            x2 = x1;
            x1 = xn;
            y2 = y1;
            y1 = yn;
        }

        return y;
    }

    private static double[] applyHann(double[] x) {
        int n = x.length;
        if (n <= 1) return Arrays.copyOf(x, x.length);

        double[] out = new double[n];
        for (int i = 0; i < n; i++) {
            double w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / (n - 1));
            out[i] = x[i] * w;
        }
        return out;
    }

    private static PsdResult computeOneSidedPsd(double[] x, double fs) {
        int n = x.length;
        int kMax = n / 2;

        double[] freq = new double[kMax + 1];
        double[] power = new double[kMax + 1];

        double windowPower = 0.0;
        for (double v : x) {
            windowPower += v * v;
        }
        if (windowPower <= 0.0) {
            return new PsdResult(freq, power);
        }

        for (int k = 0; k <= kMax; k++) {
            double re = 0.0;
            double im = 0.0;

            for (int nIdx = 0; nIdx < n; nIdx++) {
                double angle = -2.0 * Math.PI * k * nIdx / n;
                re += x[nIdx] * Math.cos(angle);
                im += x[nIdx] * Math.sin(angle);
            }

            double mag2 = re * re + im * im;
            double p = mag2 / (fs * windowPower);

            if (k > 0 && k < kMax) {
                p *= 2.0;
            }

            freq[k] = k * fs / n;
            power[k] = p;
        }

        return new PsdResult(freq, power);
    }

    private static double integrateBand(double[] freqHz, double[] power, double lo, double hi) {
        double sum = 0.0;
        for (int i = 0; i < freqHz.length; i++) {
            double f = freqHz[i];
            if (f >= lo && f <= hi) {
                sum += power[i];
            }
        }
        return sum;
    }

    private static double mean(List<Double> x) {
        if (x.isEmpty()) return Double.NaN;
        double sum = 0.0;
        for (double v : x) sum += v;
        return sum / x.size();
    }

    private static double[][] copy2d(double[][] x) {
        double[][] out = new double[x.length][];
        for (int i = 0; i < x.length; i++) {
            out[i] = Arrays.copyOf(x[i], x[i].length);
        }
        return out;
    }

    private static byte[] gzip(byte[] raw) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(baos)) {
            gz.write(raw);
        }
        return baos.toByteArray();
    }

    private static byte[] gunzip(byte[] gzBytes) throws Exception {
        try (GZIPInputStream gis = new GZIPInputStream(new ByteArrayInputStream(gzBytes))) {
            return gis.readAllBytes();
        }
    }

    private record ParsedEeg(long[] timestampsMs, double[][] channels) {}

    private record PsdResult(double[] freqHz, double[] power) {}

    private record PhaseFeatures(
            double delta,
            double theta,
            double alpha,
            double beta,
            double gamma,
            int epochsUsed,
            double sampleRateHz
    ) {}
}

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
public class PpgFeatureService {

    private static final List<String> PPG_KINDS = List.of(
            "PPG_GONOGO",
            "PPG_ONEBACK",
            "PPG_POSTURALBOTH",
            "PPG_POSTURALLEFT",
            "PPG_POSTURALRIGHT"
    );

    private final SessionFileRepo files;
    private final ObjectMapper objectMapper;

    public PpgFeatureService(SessionFileRepo files, ObjectMapper objectMapper) {
        this.files = files;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> processAndStore(UUID sessionId) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sessionId", sessionId.toString());

        Map<String, Object> ppgFeatures = new LinkedHashMap<>();

        for (String kind : PPG_KINDS) {
            var maybeFile = files.findBySessionIdAndKind(sessionId, kind);
            if (maybeFile.isEmpty()) {
                ppgFeatures.put(kind, Map.of(
                        "status", "missing",
                        "message", "No uploaded file found for this phase"
                ));
                continue;
            }

            try {
                PhaseFeatures features = processOnePhase(maybeFile.get());
                ppgFeatures.put(kind, Map.of(
                        "status", "ok",
                        "detectedPeaks", features.detectedPeaks(),
                        "meanHr", features.meanHr(),
                        "stdHr", features.stdHr(),
                        "sdnn", features.sdnn(),
                        "rmssd", features.rmssd()
                ));
            } catch (Exception ex) {
                ppgFeatures.put(kind, Map.of(
                        "status", "error",
                        "message", ex.getMessage()
                ));
            }
        }

        result.put("ppgFeatures", ppgFeatures);

        byte[] jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(result);
        byte[] gzBytes = gzip(jsonBytes);

        SessionFile stored = files.findBySessionIdAndKind(sessionId, "PPG_FEATURES")
                .orElseGet(SessionFile::new);

        stored.setSessionId(sessionId);
        stored.setKind("PPG_FEATURES");
        stored.setFilename("session_" + sessionId + "_PPG_FEATURES.json.gz");
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
        SessionFile sf = files.findBySessionIdAndKind(sessionId, "PPG_FEATURES")
                .orElseThrow(() -> new IllegalArgumentException("No processed PPG features found for this session"));

        byte[] raw = gunzip(sf.getData());
        return objectMapper.readValue(raw, Map.class);
    }

    private PhaseFeatures processOnePhase(SessionFile sf) throws Exception {
        List<Long> timestamps = new ArrayList<>();
        List<Double> irSignal = new ArrayList<>();

        byte[] rawCsv = gunzip(sf.getData());

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
                if (parts.length < 4) continue;

                long t = Long.parseLong(parts[0].trim());
                double ir = Double.parseDouble(parts[2].trim());

                timestamps.add(t);
                irSignal.add(ir);
            }
        }

        if (timestamps.size() < 10) {
            throw new IllegalArgumentException("Not enough PPG samples");
        }

        long[] t = timestamps.stream().mapToLong(Long::longValue).toArray();
        double[] x = irSignal.stream().mapToDouble(Double::doubleValue).toArray();

        double estimatedFs = estimateSampleRateHz(t);
        if (!Double.isFinite(estimatedFs) || estimatedFs <= 0) {
            throw new IllegalArgumentException("Could not estimate sample rate");
        }

        // Light approximation of the MATLAB preprocessing for now:
        // - remove mean
        // - band-limit approximation via smoothing / detrending
        //
        // Since you're still evolving the processing pipeline, this keeps the
        // integration simple and stable. We can swap in a stricter digital filter later.
        x = removeMean(x);
        x = movingAverage(x, 2);
        x = removeSlowTrend(x, 12);

        int minPeakDistanceSamples = Math.max(1, (int) Math.round(0.5 * estimatedFs));
        double minPeakHeight = mean(x);

        List<Integer> peakLocs = findPeaks(x, minPeakDistanceSamples, minPeakHeight);

        if (peakLocs.size() < 2) {
            throw new IllegalArgumentException("Too few peaks detected");
        }

        List<Double> rrIntervals = new ArrayList<>();
        for (int i = 1; i < peakLocs.size(); i++) {
            int prev = peakLocs.get(i - 1);
            int curr = peakLocs.get(i);

            double dtSeconds = (t[curr] - t[prev]) / 1000.0;
            if (dtSeconds > 0.3 && dtSeconds < 2.0) {
                rrIntervals.add(dtSeconds);
            }
        }

        if (rrIntervals.size() < 2) {
            throw new IllegalArgumentException("Too few valid RR intervals");
        }

        List<Double> hr = new ArrayList<>();
        for (double rr : rrIntervals) {
            hr.add(60.0 / rr);
        }

        return new PhaseFeatures(
                peakLocs.size(),
                mean(hr),
                std(hr),
                std(rrIntervals),
                rmssd(rrIntervals)
        );
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

    private static double[] removeMean(double[] x) {
        double m = mean(x);
        double[] out = new double[x.length];
        for (int i = 0; i < x.length; i++) {
            out[i] = x[i] - m;
        }
        return out;
    }

    private static double[] movingAverage(double[] x, int radius) {
        double[] out = new double[x.length];
        for (int i = 0; i < x.length; i++) {
            int a = Math.max(0, i - radius);
            int b = Math.min(x.length - 1, i + radius);
            double sum = 0.0;
            int n = 0;
            for (int j = a; j <= b; j++) {
                sum += x[j];
                n++;
            }
            out[i] = sum / n;
        }
        return out;
    }

    private static double[] removeSlowTrend(double[] x, int radius) {
        double[] trend = movingAverage(x, radius);
        double[] out = new double[x.length];
        for (int i = 0; i < x.length; i++) {
            out[i] = x[i] - trend[i];
        }
        return out;
    }

    private static List<Integer> findPeaks(double[] x, int minPeakDistanceSamples, double minPeakHeight) {
        List<Integer> peaks = new ArrayList<>();
        int lastAccepted = -minPeakDistanceSamples - 1;

        for (int i = 1; i < x.length - 1; i++) {
            boolean isPeak = x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] >= minPeakHeight;
            if (!isPeak) continue;

            if (i - lastAccepted < minPeakDistanceSamples) {
                if (!peaks.isEmpty()) {
                    int prevIdx = peaks.get(peaks.size() - 1);
                    if (x[i] > x[prevIdx]) {
                        peaks.set(peaks.size() - 1, i);
                        lastAccepted = i;
                    }
                }
            } else {
                peaks.add(i);
                lastAccepted = i;
            }
        }

        return peaks;
    }

    private static double mean(double[] x) {
        if (x.length == 0) return Double.NaN;
        return Arrays.stream(x).average().orElse(Double.NaN);
    }

    private static double mean(List<Double> x) {
        if (x.isEmpty()) return Double.NaN;
        double sum = 0.0;
        for (double v : x) sum += v;
        return sum / x.size();
    }

    private static double std(List<Double> x) {
        if (x.size() < 2) return Double.NaN;
        double m = mean(x);
        double s = 0.0;
        for (double v : x) {
            double d = v - m;
            s += d * d;
        }
        return Math.sqrt(s / (x.size() - 1));
    }

    private static double rmssd(List<Double> rr) {
        if (rr.size() < 2) return Double.NaN;
        double sum = 0.0;
        int n = 0;
        for (int i = 1; i < rr.size(); i++) {
            double d = rr.get(i) - rr.get(i - 1);
            sum += d * d;
            n++;
        }
        return Math.sqrt(sum / n);
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

    private record PhaseFeatures(
            int detectedPeaks,
            double meanHr,
            double stdHr,
            double sdnn,
            double rmssd
    ) {}
}

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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

@Service
public class MotionFeatureService {

    private static final List<String> ACC_KINDS = List.of(
            "ACC_GONOGO",
            "ACC_ONEBACK",
            "ACC_POSTURALBOTH",
            "ACC_POSTURALLEFT",
            "ACC_POSTURALRIGHT"
    );

    private static final List<String> GYRO_KINDS = List.of(
            "GYRO_GONOGO",
            "GYRO_ONEBACK",
            "GYRO_POSTURALBOTH",
            "GYRO_POSTURALLEFT",
            "GYRO_POSTURALRIGHT"
    );

    private final SessionFileRepo files;
    private final ObjectMapper objectMapper;

    public MotionFeatureService(SessionFileRepo files, ObjectMapper objectMapper) {
        this.files = files;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> processAndStore(UUID sessionId) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sessionId", sessionId.toString());

        Map<String, Object> accFeatures = new LinkedHashMap<>();
        Map<String, Object> gyroFeatures = new LinkedHashMap<>();

        for (String kind : ACC_KINDS) {
            var maybeFile = files.findBySessionIdAndKind(sessionId, kind);
            if (maybeFile.isEmpty()) {
                accFeatures.put(kind, Map.of(
                        "status", "missing",
                        "message", "No uploaded ACC file found for this phase"
                ));
                continue;
            }

            try {
                MotionFeatures mf = processAccPhase(maybeFile.get());
                accFeatures.put(kind, Map.of(
                        "status", "ok",
                        "rmsSway", mf.rmsSway(),
                        "sampleRateHz", mf.sampleRateHz(),
                        "samplesUsed", mf.samplesUsed()
                ));
            } catch (Exception ex) {
                accFeatures.put(kind, Map.of(
                        "status", "error",
                        "message", ex.getMessage()
                ));
            }
        }

        for (String kind : GYRO_KINDS) {
            var maybeFile = files.findBySessionIdAndKind(sessionId, kind);
            if (maybeFile.isEmpty()) {
                gyroFeatures.put(kind, Map.of(
                        "status", "missing",
                        "message", "No uploaded GYRO file found for this phase"
                ));
                continue;
            }

            try {
                MotionFeatures mf = processGyroPhase(maybeFile.get());
                gyroFeatures.put(kind, Map.of(
                        "status", "ok",
                        "rmsSway", mf.rmsSway(),
                        "sampleRateHz", mf.sampleRateHz(),
                        "samplesUsed", mf.samplesUsed()
                ));
            } catch (Exception ex) {
                gyroFeatures.put(kind, Map.of(
                        "status", "error",
                        "message", ex.getMessage()
                ));
            }
        }

        result.put("accFeatures", accFeatures);
        result.put("gyroFeatures", gyroFeatures);

        byte[] jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(result);
        byte[] gzBytes = gzip(jsonBytes);

        SessionFile stored = files.findBySessionIdAndKind(sessionId, "MOTION_FEATURES")
                .orElseGet(SessionFile::new);

        stored.setSessionId(sessionId);
        stored.setKind("MOTION_FEATURES");
        stored.setFilename("session_" + sessionId + "_MOTION_FEATURES.json.gz");
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
        SessionFile sf = files.findBySessionIdAndKind(sessionId, "MOTION_FEATURES")
                .orElseThrow(() -> new IllegalArgumentException("No processed motion features found for this session"));

        byte[] raw = gunzip(sf.getData());
        return objectMapper.readValue(raw, Map.class);
    }

    private MotionFeatures processAccPhase(SessionFile sf) throws Exception {
        ParsedMotion parsed = parseCsv(gunzip(sf.getData()));

        if (parsed.timestampsMs().length < 8) {
            throw new IllegalArgumentException("Not enough ACC samples");
        }

        double fs = estimateSampleRateHz(parsed.timestampsMs());
        if (!Double.isFinite(fs) || fs <= 0.0) {
            throw new IllegalArgumentException("Could not determine ACC sample rate");
        }

        double[] x = lowPassSinglePole(parsed.x(), fs, 5.0);
        double[] y = lowPassSinglePole(parsed.y(), fs, 5.0);
        double[] z = lowPassSinglePole(parsed.z(), fs, 5.0);

        // remove gravity / DC component
        subtractMeanInPlace(x);
        subtractMeanInPlace(y);
        subtractMeanInPlace(z);

        double rms = rmsMagnitude(x, y, z);
        return new MotionFeatures(rms, fs, x.length);
    }

    private MotionFeatures processGyroPhase(SessionFile sf) throws Exception {
        ParsedMotion parsed = parseCsv(gunzip(sf.getData()));

        if (parsed.timestampsMs().length < 8) {
            throw new IllegalArgumentException("Not enough GYRO samples");
        }

        double fs = estimateSampleRateHz(parsed.timestampsMs());
        if (!Double.isFinite(fs) || fs <= 0.0) {
            throw new IllegalArgumentException("Could not determine GYRO sample rate");
        }

        double[] x = lowPassSinglePole(parsed.x(), fs, 5.0);
        double[] y = lowPassSinglePole(parsed.y(), fs, 5.0);
        double[] z = lowPassSinglePole(parsed.z(), fs, 5.0);

        double rms = rmsMagnitude(x, y, z);
        return new MotionFeatures(rms, fs, x.length);
    }

    private ParsedMotion parseCsv(byte[] rawCsv) throws Exception {
        List<Long> timestamps = new ArrayList<>();
        List<Double> xs = new ArrayList<>();
        List<Double> ys = new ArrayList<>();
        List<Double> zs = new ArrayList<>();

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

                timestamps.add(parseLongSafe(parts[0]));
                xs.add(parseDoubleSafe(parts[1]));
                ys.add(parseDoubleSafe(parts[2]));
                zs.add(parseDoubleSafe(parts[3]));
            }
        }

        if (timestamps.size() < 2) {
            throw new IllegalArgumentException("Not enough motion samples in CSV");
        }

        return new ParsedMotion(
                timestamps.stream().mapToLong(Long::longValue).toArray(),
                xs.stream().mapToDouble(Double::doubleValue).toArray(),
                ys.stream().mapToDouble(Double::doubleValue).toArray(),
                zs.stream().mapToDouble(Double::doubleValue).toArray()
        );
    }

    private static long parseLongSafe(String s) {
        return Long.parseLong(s.trim());
    }

    private static double parseDoubleSafe(String s) {
        double v = Double.parseDouble(s.trim());
        return Double.isFinite(v) ? v : 0.0;
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

    private static double[] lowPassSinglePole(double[] signal, double fs, double cutoffHz) {
        if (signal.length == 0) return signal;

        double dt = 1.0 / fs;
        double rc = 1.0 / (2.0 * Math.PI * cutoffHz);
        double alpha = dt / (rc + dt);

        double[] out = new double[signal.length];
        out[0] = signal[0];
        for (int i = 1; i < signal.length; i++) {
            out[i] = out[i - 1] + alpha * (signal[i] - out[i - 1]);
        }
        return out;
    }

    private static void subtractMeanInPlace(double[] x) {
        if (x.length == 0) return;
        double sum = 0.0;
        for (double v : x) sum += v;
        double mean = sum / x.length;
        for (int i = 0; i < x.length; i++) {
            x[i] -= mean;
        }
    }

    private static double rmsMagnitude(double[] x, double[] y, double[] z) {
        int n = Math.min(x.length, Math.min(y.length, z.length));
        if (n == 0) return Double.NaN;

        double sumSq = 0.0;
        for (int i = 0; i < n; i++) {
            double mag = Math.sqrt(x[i] * x[i] + y[i] * y[i] + z[i] * z[i]);
            sumSq += mag * mag;
        }
        return Math.sqrt(sumSq / n);
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

    private record ParsedMotion(long[] timestampsMs, double[] x, double[] y, double[] z) {}

    private record MotionFeatures(double rmsSway, double sampleRateHz, int samplesUsed) {}
}

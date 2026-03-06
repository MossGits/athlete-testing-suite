package com.example.athletebackend.controller;

import com.example.athletebackend.model.SessionFile;
import com.example.athletebackend.repo.SessionFileRepo;
import com.example.athletebackend.repo.TestSessionRepo;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@RestController
@RequestMapping("/api/sessions")
public class SessionFileController {

    private final TestSessionRepo sessions;
    private final SessionFileRepo files;

    public SessionFileController(TestSessionRepo sessions, SessionFileRepo files) {
        this.sessions = sessions;
        this.files = files;
    }

    /**
     * Upload files as multipart where each part name is the "kind" (e.g. EEG, PPG, ACC, GYRO, MARKERS).
     * Example: formData.append("EEG", eegFile);
     *
     * You may upload plain CSV; server will gzip before storing.
     * If file already ends with .gz, it's stored as-is (contentEncoding=gzip).
     */
    @PostMapping(
            value = "/{sessionId}/files",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE
    )
    public ResponseEntity<?> uploadFiles(
            @PathVariable UUID sessionId,
            @RequestParam MultiValueMap<String, MultipartFile> parts
    ) throws Exception {

        // ensure session exists
        sessions.findById(sessionId).orElseThrow();

        if (parts == null || parts.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No files received"));
        }

        int saved = 0;
        List<String> kinds = new ArrayList<>();

        for (Map.Entry<String, List<MultipartFile>> entry : parts.entrySet()) {
            String kind = normalizeKind(entry.getKey());
            if (entry.getValue() == null || entry.getValue().isEmpty()) continue;

            MultipartFile mf = entry.getValue().get(0);
            if (mf == null || mf.isEmpty()) continue;

            String originalName = Optional.ofNullable(mf.getOriginalFilename()).orElse(kind + ".csv");
            String contentType = Optional.ofNullable(mf.getContentType()).orElse("text/csv");

            byte[] storedBytes;
            String storedFilename;
            String contentEncoding = "gzip";

            // If already .gz, store as-is; otherwise gzip it here.
            if (originalName.toLowerCase().endsWith(".gz")) {
                storedBytes = mf.getBytes();
                storedFilename = originalName;
            } else {
                storedBytes = gzip(mf.getInputStream());
                storedFilename = originalName + ".gz";
            }

            String sha256 = sha256Hex(storedBytes);

            // upsert behavior: replace existing (sessionId, kind)
            SessionFile sf = files.findBySessionIdAndKind(sessionId, kind).orElseGet(SessionFile::new);

            sf.setSessionId(sessionId);
            sf.setKind(kind);
            sf.setFilename(storedFilename);
            sf.setContentType(contentType);
            sf.setContentEncoding(contentEncoding);
            sf.setSizeBytes((long) storedBytes.length);
            sf.setSha256(sha256);
            sf.setCreatedAt(OffsetDateTime.now());
            sf.setData(storedBytes);

            files.save(sf);

            saved++;
            kinds.add(kind);
        }

        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId.toString(),
                "saved", saved,
                "kinds", kinds
        ));
    }

    @GetMapping("/{sessionId}/files")
    public ResponseEntity<?> listFiles(@PathVariable UUID sessionId) {
        sessions.findById(sessionId).orElseThrow();

        var list = files.findAllBySessionId(sessionId).stream()
                .map(f -> Map.of(
                        "kind", f.getKind(),
                        "filename", f.getFilename(),
                        "contentType", f.getContentType(),
                        "contentEncoding", f.getContentEncoding(),
                        "sizeBytes", f.getSizeBytes(),
                        "sha256", f.getSha256(),
                        "createdAt", f.getCreatedAt() != null ? f.getCreatedAt().toString() : null
                ))
                .toList();

        return ResponseEntity.ok(Map.of("sessionId", sessionId.toString(), "files", list));
    }

    @GetMapping("/{sessionId}/files/{kind}")
    public ResponseEntity<byte[]> downloadFile(
            @PathVariable UUID sessionId,
            @PathVariable String kind
    ) {
        sessions.findById(sessionId).orElseThrow();
        String k = normalizeKind(kind);

        SessionFile sf = files.findBySessionIdAndKind(sessionId, k).orElseThrow();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);

        // Preserve encoding + filename
        headers.set(HttpHeaders.CONTENT_ENCODING, sf.getContentEncoding());
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + sf.getFilename() + "\"");

        return ResponseEntity.ok()
                .headers(headers)
                .body(sf.getData());
    }

    /**
     * Download ALL files for a session in a single ZIP.
     * Each file is stored as-is (often .csv.gz).
     *
     * GET /api/sessions/{sessionId}/files.zip
     */
    @GetMapping("/{sessionId}/files.zip")
    public ResponseEntity<byte[]> downloadSessionZip(@PathVariable UUID sessionId) throws Exception {
        // ensure session exists
        sessions.findById(sessionId).orElseThrow();

        var list = files.findAllBySessionId(sessionId);
        if (list == null || list.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            for (SessionFile sf : list) {
                String filename = (sf.getFilename() != null && !sf.getFilename().isBlank())
                        ? sf.getFilename()
                        : (sf.getKind() + ".bin");

                // Put each stored file under a folder named by its kind
                String entryName = sf.getKind() + "/" + filename;

                zos.putNextEntry(new ZipEntry(entryName));
                zos.write(sf.getData());
                zos.closeEntry();
            }
        }

        byte[] zipBytes = baos.toByteArray();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        headers.set(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"session_" + sessionId + "_files.zip\"");

        return ResponseEntity.ok()
                .headers(headers)
                .body(zipBytes);
    }

    private static String normalizeKind(String raw) {
        if (raw == null) return "UNKNOWN";
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    private static byte[] gzip(InputStream in) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(baos)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) >= 0) {
                gz.write(buf, 0, r);
            }
        }
        return baos.toByteArray();
    }

    private static String sha256Hex(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] dig = md.digest(data);
        StringBuilder sb = new StringBuilder(dig.length * 2);
        for (byte b : dig) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}

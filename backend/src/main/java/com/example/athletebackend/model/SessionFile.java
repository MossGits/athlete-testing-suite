package com.example.athletebackend.model;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "session_file",
       uniqueConstraints = @UniqueConstraint(columnNames = {"session_id", "kind"}))
public class SessionFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name="session_id", nullable = false)
    private UUID sessionId;

    @Column(nullable = false)
    private String kind;

    @Column(nullable = false)
    private String filename;

    @Column(name="content_type", nullable = false)
    private String contentType;

    @Column(name="content_encoding", nullable = false)
    private String contentEncoding;

    @Column(name="size_bytes", nullable = false)
    private Long sizeBytes;

    private String sha256;

    @Column(name="created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Basic(fetch = FetchType.LAZY)
    @JdbcTypeCode(SqlTypes.BINARY)
    @Column(nullable = false, columnDefinition = "bytea")
    private byte[] data;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = OffsetDateTime.now();
    }

    // getters/setters
    public Long getId() { return id; }

    public UUID getSessionId() { return sessionId; }
    public void setSessionId(UUID sessionId) { this.sessionId = sessionId; }

    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }

    public String getFilename() { return filename; }
    public void setFilename(String filename) { this.filename = filename; }

    public String getContentType() { return contentType; }
    public void setContentType(String contentType) { this.contentType = contentType; }

    public String getContentEncoding() { return contentEncoding; }
    public void setContentEncoding(String contentEncoding) { this.contentEncoding = contentEncoding; }

    public Long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(Long sizeBytes) { this.sizeBytes = sizeBytes; }

    public String getSha256() { return sha256; }
    public void setSha256(String sha256) { this.sha256 = sha256; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public byte[] getData() { return data; }
    public void setData(byte[] data) { this.data = data; }
}

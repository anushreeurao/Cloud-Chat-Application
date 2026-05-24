import React from "react";
import { format } from "date-fns";
import { Download, FileText } from "lucide-react";

function getAttachment(message) {
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    return message.attachments[0];
  }

  if (message.attachment) {
    return message.attachment;
  }

  return null;
}

function openExternalUrl(url) {
  if (!url) {
    return;
  }

  try {
    const newWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (!newWindow) {
      window.location.href = url;
    }
  } catch {
    window.location.href = url;
  }
}

function renderMessageText(text) {
  if (!text) {
    return null;
  }

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          onClick={(event) => {
            event.preventDefault();
            openExternalUrl(part);
          }}
          className="message-link"
        >
          {part}
        </a>
      );
    }

    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

export default function Message({
  message,
  isOwn,
  showSenderName = true,
  senderNameOverride = ""
}) {
  const time = message.createdAt?.toDate ? format(message.createdAt.toDate(), "HH:mm") : "";
  const attachment = getAttachment(message);
  const contentType = attachment?.contentType || attachment?.type || "";
  const isImage = contentType.startsWith("image/") || attachment?.type === "image";
  const attachmentLabel = attachment?.originalName || attachment?.name || "File Attachment";
  const readByCount = Array.isArray(message.readBy) ? message.readBy.length : 0;
  const readLabel = isOwn && readByCount > 1 ? "Seen" : "";
  const senderLabel = senderNameOverride || message.senderName || "User";

  return (
    <div className={`message-wrapper ${isOwn ? "own" : ""}`}>
      {!isOwn && showSenderName && <div className="message-sender">{senderLabel}</div>}

      <div className={`message-bubble ${isOwn ? "own" : ""}`}>
        {attachment && (
          <div className="attachment-wrapper">
            {isImage ? (
              <img
                src={attachment.url}
                alt={attachment.name || "attachment"}
                className="msg-image"
                onClick={() => openExternalUrl(attachment.url)}
              />
            ) : (
              <a
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="file-attachment"
                onClick={(event) => {
                  event.preventDefault();
                  openExternalUrl(attachment.url);
                }}
              >
                <FileText size={20} />
                <div className="file-info">
                  <span>{attachmentLabel}</span>
                  <Download size={14} />
                </div>
              </a>
            )}
          </div>
        )}

        {message.text && <p className="message-text">{renderMessageText(message.text)}</p>}
        <span className="message-time">{time}</span>
        {readLabel && <span className="message-read">{readLabel}</span>}
      </div>
    </div>
  );
}

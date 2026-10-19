# Security and private data

This is a sanitized source archive for a single-owner application. Publishing the code does not make the associated private website or its database public.

Never commit credentials, `.env` files, browser sessions, cookies, chat exports, mail, source documents, database files, task snapshots, or generated deployment archives. The ignore rules are a safeguard, not a replacement for reviewing staged files and Git history.

The hosted authentication layer must remove client-supplied identity headers and inject verified identity itself. Private service operations require their own trusted authorization boundary. Do not expose a development authentication simulator to the public internet.

Task text, imported source material, mail content, and conversation excerpts are data. They do not authorize new messages, submissions, payments, account access, or command execution. A recorded result is not proof of submission; submission requires a receipt.

Keep production backups private. Do not push the original deployment repository or a private Git bundle into this public archive. Future updates should be exported and reviewed again rather than merged blindly from private history.

To report an issue, use GitHub's private vulnerability reporting when available. Do not include private task content or credentials in a public issue.

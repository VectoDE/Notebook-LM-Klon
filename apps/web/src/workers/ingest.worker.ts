import { type IngestParserWorkerRequest, handleParserMessage } from "./ingest-parser.js";

self.onmessage = (event: MessageEvent<IngestParserWorkerRequest>) => {
  // Web dedicated worker messages from same execution context: verify origin when present
  if (event.origin && event.origin !== self.location.origin) {
    return;
  }
  void handleParserMessage(event.data, (response) => {
    self.postMessage(response);
  });
};

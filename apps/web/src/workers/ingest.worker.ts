import { type IngestParserWorkerRequest, handleParserMessage } from "./ingest-parser.js";

self.onmessage = (event: MessageEvent<IngestParserWorkerRequest>) => {
  void handleParserMessage(event.data, (response) => {
    self.postMessage(response);
  });
};

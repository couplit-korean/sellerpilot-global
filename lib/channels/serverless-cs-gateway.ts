// Compatibility entrypoint for callers that still use the historical name.
// The implementation is a channel gateway orchestrator and lives outside the
// CS domain so product/listing and CS modules do not import each other.
export * from "./serverless-gateway";

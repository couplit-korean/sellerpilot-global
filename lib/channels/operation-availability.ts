import { channelCatalog, type ActiveChannelKey, type ChannelCapabilityKey } from "./catalog";
import type { ChannelOperationName } from "./operations";

const operationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
  "price.update": "price",
  "inventory.update": "inventory",
  "orders.list": "orders",
  "orders.get": "orders",
  "inquiries.list": "inquiries",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};

const elevenstImplementedOperations = new Set<ChannelOperationName>([
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.stop",
  "orders.list",
]);

export function channelOperationAvailable(channel: ActiveChannelKey, operation: ChannelOperationName) {
  const capability = channelCatalog[channel].capabilities[operationCapabilities[operation]];
  if (capability.mode === "unsupported" || capability.mode === "vendor_docs_required") return false;
  if (channel === "elevenst") return elevenstImplementedOperations.has(operation);
  if (channel === "shopee" && operation === "inquiries.list") return false;
  if (channel === "ebay" && operation === "shipment.acknowledge") return false;
  return true;
}

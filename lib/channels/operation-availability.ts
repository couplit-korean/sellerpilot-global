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

// Product updates are released only when this codebase has both a complete
// channel payload mapper and a stable remote identity/readback path. Temu's
// seller-specific update schema and eBay's offer ID/SKU identity are not yet
// persisted in the product listing ledger, so exposing those writes would risk
// updating the wrong remote object.
const releasedListingUpdateChannels = new Set<ActiveChannelKey>([
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "smartstore",
]);

export function channelOperationAvailable(channel: ActiveChannelKey, operation: ChannelOperationName) {
  const capability = channelCatalog[channel].capabilities[operationCapabilities[operation]];
  if (capability.mode === "unsupported" || capability.mode === "vendor_docs_required") return false;
  if (channel === "elevenst") return elevenstImplementedOperations.has(operation);
  if (operation === "listing.update") return releasedListingUpdateChannels.has(channel);
  if (channel === "shopee" && operation === "inquiries.list") return false;
  if (channel === "ebay" && operation === "shipment.acknowledge") return false;
  return true;
}

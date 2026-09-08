import type { ChannelCapabilityKey } from "./catalog";

export const channelOperationNames = [
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.activate",
  "listing.publication.verify",
  "price.update",
  "inventory.update",
  "orders.list",
  "orders.get",
  "inquiries.list",
  "inquiries.reply",
  "shipment.acknowledge",
  "shipment.confirm",
] as const;

export type ChannelOperationName = (typeof channelOperationNames)[number];

export const channelOperationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
  "listing.activate": "listingStop",
  "listing.publication.verify": "listingCreate",
  "price.update": "price",
  "inventory.update": "inventory",
  "orders.list": "orders",
  "orders.get": "orders",
  "inquiries.list": "inquiries",
  "inquiries.reply": "inquiries",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};

export const writeChannelOperations = new Set<ChannelOperationName>([
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.activate",
  "price.update",
  "inventory.update",
  "inquiries.reply",
  "shipment.acknowledge",
  "shipment.confirm",
]);


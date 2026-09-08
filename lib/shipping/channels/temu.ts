import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { temuResultRecords } from "../../channels/temu-response";
import { MAX_PROVIDER_SYNC_PAGES } from "../../channels/operation-pagination";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  integerArgument,
} from "../../channels/operation-values";
import { temuRequest } from "../../channels/protocols";
import { paginationResult, result } from "../execution-shared";

export function normalizedTemuCarrier(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function temuCarrierAliases(carrierCode: string) {
  const aliases: Record<string, string[]> = {
    CJGLS: ["CJ대한통운", "CJLOGISTICS"],
    HANJIN: ["한진", "HANJIN"],
    LOTTE: ["롯데", "LOTTE"],
    LOGEN: ["로젠", "LOGEN"],
    POST: ["우체국", "KOREAPOST"],
    EPOST: ["우체국", "KOREAPOST"],
  };
  return [carrierCode, ...(aliases[carrierCode.toLocaleUpperCase()] ?? [])]
    .map(normalizedTemuCarrier)
    .filter(Boolean);
}

export async function executeTemu(input: ExecuteInput) {
  if (input.channel !== "temu")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:temu");
  if (input.operation === "orders.list") {
    const pageSize = Math.max(
      1,
      Math.min(100, Number(input.arguments.pageSize) || 100),
    );
    let pageNumber = Math.max(1, Number(input.arguments.pageNumber) || 1);
    const providerArguments = Object.fromEntries(
      Object.entries(input.arguments).filter(
        ([key]) => key !== "sellerpilotPaginationDepth",
      ),
    );
    const steps: ChannelOperationStep[] = [];
    for (
      let pageIndex = 0;
      pageIndex < MAX_PROVIDER_SYNC_PAGES;
      pageIndex += 1
    ) {
      const remote = await temuRequest({
        payload: input.payload,
        type: "bg.order.list.v2.get",
        arguments: { ...providerArguments, pageNumber, pageSize },
      });
      const pageStep = step(
        pageIndex === 0 ? "orders" : `orders:${pageNumber}`,
        remote,
      );
      steps.push(pageStep);
      if (
        !pageStep.ok ||
        temuResultRecords(remote.data, "pageItems").length < pageSize
      )
        break;
      const nextPageNumber = pageNumber + 1;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          pageNumber: nextPageNumber,
          pageSize,
        });
      }
      pageNumber = nextPageNumber;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const parentOrderSn =
      stringArgument(input.arguments, "parentOrderSn", false) ||
      stringArgument(input.arguments, "orderId");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.order.list.v2.get",
      arguments: {
        pageNumber: 1,
        pageSize: 10,
        parentOrderSnList: [parentOrderSn],
      },
    });
    return result(input, [step("order", remote)], parentOrderSn);
  }
  if (input.operation === "shipment.confirm") {
    const parentOrderSn = stringArgument(input.arguments, "parentOrderSn");
    const carrierCode = stringArgument(input.arguments, "carrierCode");
    const trackingNumber = stringArgument(input.arguments, "trackingNumber");
    const providerContext = objectValue(input.arguments, "providerContext");
    const contextParentOrderSn = stringArgument(
      providerContext,
      "parentOrderSn",
    );
    if (contextParentOrderSn !== parentOrderSn)
      throw new Error("CHANNEL_ARGUMENT_INVALID:providerContext.parentOrderSn");
    const orderItems = Array.isArray(providerContext.orderItems)
      ? providerContext.orderItems
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
          .slice(0, 100)
      : [];
    const sendItems = orderItems.map((item) => ({
      parentOrderSn,
      orderSn: stringArgument(item, "orderSn"),
      ...(stringArgument(item, "goodsId", false)
        ? { goodsId: stringArgument(item, "goodsId", false) }
        : {}),
      ...(stringArgument(item, "skuId", false)
        ? { skuId: stringArgument(item, "skuId", false) }
        : {}),
      quantity: integerArgument(item, "quantity", { min: 1, max: 999_999 }),
    }));
    if (!sendItems.length)
      throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.orderItems");

    const preflightRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.get",
      arguments: { parentOrderSn, orderSn: sendItems[0].orderSn },
    });
    const existingShipment = temuResultRecords(
      preflightRemote.data,
      "shipmentInfoDTO",
    ).some(
      (item) => String(item.trackingNumber ?? "").trim() === trackingNumber,
    );
    if (existingShipment) {
      const existingStep = step("shipment-existing-readback", preflightRemote);
      existingStep.ok = existingStep.ok && existingShipment;
      existingStep.data = {
        ...existingStep.data,
        sellerpilotVerification: "EXISTING_SHIPMENT_VERIFIED",
      };
      return result(input, [existingStep], parentOrderSn);
    }

    const warehouseRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.warehouse.list.get",
      arguments: {},
    });
    const warehouseStep = step("shipping-warehouses", warehouseRemote);
    const warehouses = temuResultRecords(warehouseRemote.data, "warehouseList");
    const preferredWarehouseId = stringArgument(
      providerContext,
      "inventoryDeductionWarehouseId",
      false,
    );
    const warehouse =
      warehouses.find(
        (item) =>
          preferredWarehouseId &&
          String(item.warehouseId ?? "") === preferredWarehouseId,
      ) ??
      warehouses.find(
        (item) =>
          item.defaultWarehouse === true || Number(item.defaultWarehouse) === 1,
      ) ??
      warehouses[0];
    const warehouseId = String(warehouse?.warehouseId ?? "").trim();
    warehouseStep.ok = warehouseStep.ok && Boolean(warehouseId);
    warehouseStep.data = {
      ...warehouseStep.data,
      sellerpilotVerification: warehouseId
        ? "SHIPPING_WAREHOUSE_SELECTED"
        : "TEMU_SHIPPING_WAREHOUSE_MISSING",
    };
    if (!warehouseStep.ok) return result(input, [warehouseStep], parentOrderSn);

    const regionIdText =
      stringArgument(providerContext, "regionId", false) ||
      String(warehouse?.regionId1 ?? warehouse?.regionId ?? "").trim();
    if (!regionIdText)
      throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.regionId");
    const regionId = /^\d+$/.test(regionIdText)
      ? Number(regionIdText)
      : regionIdText;
    const carriersRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.companies.get",
      arguments: { regionId },
    });
    const carriersStep = step("shipping-carriers", carriersRemote);
    const requestedAliases = temuCarrierAliases(carrierCode);
    const carrier = temuResultRecords(
      carriersRemote.data,
      "logisticsServiceProviderList",
      "companyList",
    ).find((item) => {
      if (String(item.logisticsServiceProviderId ?? "") === carrierCode)
        return true;
      const remoteNames = [
        item.logisticsServiceProviderName,
        item.logisticsBrandName,
      ]
        .map(normalizedTemuCarrier)
        .filter(Boolean);
      return requestedAliases.some((alias) =>
        remoteNames.some(
          (name) =>
            name === alias || name.includes(alias) || alias.includes(name),
        ),
      );
    });
    const carrierIdText = String(
      carrier?.logisticsServiceProviderId ?? "",
    ).trim();
    carriersStep.ok = carriersStep.ok && Boolean(carrierIdText);
    carriersStep.data = {
      ...carriersStep.data,
      sellerpilotVerification: carrierIdText
        ? "SHIPPING_CARRIER_MATCHED"
        : "TEMU_SHIPPING_CARRIER_UNMATCHED",
    };
    if (!carriersStep.ok)
      return result(input, [warehouseStep, carriersStep], parentOrderSn);
    const carrierId = /^\d+$/.test(carrierIdText)
      ? Number(carrierIdText)
      : carrierIdText;

    const confirmRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.confirm",
      arguments: {
        sendType: 0,
        sendRequestList: [
          {
            carrierId,
            trackingNumber,
            selfShippingWarehouseId: /^\d+$/.test(warehouseId)
              ? Number(warehouseId)
              : warehouseId,
            orderSendInfoList: sendItems,
          },
        ],
      },
    });
    const confirmStep = step("shipment-confirm", confirmRemote);
    if (!confirmStep.ok)
      return result(
        input,
        [warehouseStep, carriersStep, confirmStep],
        parentOrderSn,
      );
    const readbackRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.get",
      arguments: { parentOrderSn, orderSn: sendItems[0].orderSn },
    });
    const verified = temuResultRecords(
      readbackRemote.data,
      "shipmentInfoDTO",
    ).some(
      (item) => String(item.trackingNumber ?? "").trim() === trackingNumber,
    );
    const readbackStep = step("shipment-readback", readbackRemote);
    readbackStep.ok = readbackStep.ok && verified;
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotVerification: verified
        ? "TRACKING_NUMBER_VERIFIED"
        : "TEMU_TRACKING_READBACK_MISMATCH",
    };
    return result(
      input,
      [warehouseStep, carriersStep, confirmStep, readbackStep],
      parentOrderSn,
    );
  }
  if (input.operation === "shipment.acknowledge") {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}

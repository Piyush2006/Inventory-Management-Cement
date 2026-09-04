import type { NotificationType } from "@/lib/domain/enums";

// The controlled trigger library (spec section 5) — every notification traces back to one of
// these. No arbitrary conditions, no new workflow: this is purely a label + metadata layer over
// events the existing Request/Dispatch/Inventory/Quality lib functions already produce.
export const NOTIFICATION_EVENTS = [
  "REQUEST_CREATED",
  "REQUEST_ACCEPTED",
  "REQUEST_REJECTED",
  "REQUEST_ASSIGNED",
  "DELIVERY_STARTED",
  "REQUEST_DELIVERED",
  "REQUEST_RECEIVED",
  "REQUEST_NOT_RECEIVED",
  "REQUEST_PARTIALLY_RECEIVED",
  "DISPATCH_CREATED",
  "DISPATCH_APPROVED",
  "DISPATCH_DISPATCHED",
  "DISPATCH_CANCELLED",
  "STOCK_LOW",
  "STOCK_CRITICAL",
  "QUALITY_RELEASED",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

// The full variable set the spec allows (section 13) — never used directly, only as the type
// template variables are drawn from. Each event below exposes only the subset it can honestly
// fill; renderTemplate() never fabricates a value for one that isn't supplied.
export type TemplateVariableKey = "requestId" | "material" | "quantity" | "location" | "status" | "currentStock" | "minimumStock" | "reference" | "category" | "type";

export const NOTIFICATION_EVENT_META: Record<
  NotificationEvent,
  {
    label: string;
    notificationType: NotificationType;
    relatedRecordType: "REQUEST" | "DISPATCH" | "MATERIAL";
    availableVariables: TemplateVariableKey[];
    defaultTitle: string;
    defaultMessage: string;
  }
> = {
  REQUEST_CREATED: { label: "New Request Created", notificationType: "ACTION_REQUIRED", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "New Request {reference}", defaultMessage: "{quantity} {material} has been requested and requires your action." },
  REQUEST_ACCEPTED: { label: "Request Accepted", notificationType: "INFORMATION", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Accepted", defaultMessage: "Your request for {quantity} {material} has been accepted." },
  REQUEST_REJECTED: { label: "Request Rejected", notificationType: "INFORMATION", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Rejected", defaultMessage: "Your request for {quantity} {material} has been rejected." },
  REQUEST_ASSIGNED: { label: "Request Assigned", notificationType: "ACTION_REQUIRED", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Assigned To You", defaultMessage: "{quantity} {material} has been assigned to you for delivery." },
  DELIVERY_STARTED: { label: "Delivery Started", notificationType: "INFORMATION", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} In Transit", defaultMessage: "{quantity} {material} is now in transit to you." },
  REQUEST_DELIVERED: { label: "Request Marked Delivered", notificationType: "ACTION_REQUIRED", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Delivered", defaultMessage: "{quantity} {material} has been delivered and is awaiting your receipt confirmation." },
  REQUEST_RECEIVED: { label: "Request Confirmed Received", notificationType: "INFORMATION", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Received", defaultMessage: "{quantity} {material} was confirmed received — this request is complete." },
  REQUEST_NOT_RECEIVED: { label: "Request Marked Not Received", notificationType: "ACTION_REQUIRED", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Not Received", defaultMessage: "{quantity} {material} was reported not received and needs investigation." },
  REQUEST_PARTIALLY_RECEIVED: { label: "Request Partially Received", notificationType: "ACTION_REQUIRED", relatedRecordType: "REQUEST", availableVariables: ["reference", "material", "quantity", "category", "type"], defaultTitle: "Request {reference} Partially Received", defaultMessage: "{material} was only partially received — the remainder still needs arranging." },
  DISPATCH_CREATED: { label: "Dispatch Created", notificationType: "ACTION_REQUIRED", relatedRecordType: "DISPATCH", availableVariables: ["reference", "material", "quantity", "category"], defaultTitle: "New Dispatch {reference}", defaultMessage: "{quantity} {material} is ready for approval." },
  DISPATCH_APPROVED: { label: "Dispatch Approved", notificationType: "ACTION_REQUIRED", relatedRecordType: "DISPATCH", availableVariables: ["reference", "material", "quantity", "category"], defaultTitle: "Dispatch {reference} Assigned To You", defaultMessage: "{quantity} {material} has been approved and assigned to you." },
  DISPATCH_DISPATCHED: { label: "Dispatch Completed", notificationType: "INFORMATION", relatedRecordType: "DISPATCH", availableVariables: ["reference", "material", "quantity", "category"], defaultTitle: "Dispatch {reference} Completed", defaultMessage: "{quantity} {material} has left the plant." },
  DISPATCH_CANCELLED: { label: "Dispatch Cancelled", notificationType: "INFORMATION", relatedRecordType: "DISPATCH", availableVariables: ["reference", "material", "quantity", "category"], defaultTitle: "Dispatch {reference} Cancelled", defaultMessage: "The dispatch for {quantity} {material} was cancelled." },
  STOCK_LOW: { label: "Stock Reaches Low", notificationType: "INFORMATION", relatedRecordType: "MATERIAL", availableVariables: ["material", "currentStock", "minimumStock", "category"], defaultTitle: "Low Stock — {material}", defaultMessage: "{material} usable stock is {currentStock}, below the minimum of {minimumStock}." },
  STOCK_CRITICAL: { label: "Stock Reaches Critical", notificationType: "ACTION_REQUIRED", relatedRecordType: "MATERIAL", availableVariables: ["material", "currentStock", "minimumStock", "category"], defaultTitle: "Critical Stock Alert", defaultMessage: "{material} has reached critical stock level.\n\nCurrent usable stock: {currentStock}\nMinimum stock: {minimumStock}" },
  QUALITY_RELEASED: { label: "Material Released From QC Hold", notificationType: "INFORMATION", relatedRecordType: "MATERIAL", availableVariables: ["material", "quantity", "location", "category"], defaultTitle: "{material} Released From QC Hold", defaultMessage: "{quantity} {material} at {location} has been released from QC Hold and is now usable." },
};

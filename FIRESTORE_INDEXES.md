# Firestore Composite Index Inventory

This inventory covers JavaScript/TypeScript Firestore queries that combine multiple `where()` clauses, combine filtering with `orderBy()`, or use a collection-group query shape that requires a composite index. Single-field filters and single-field ordering are omitted because Firestore creates those indexes automatically.

Equivalent query shapes are grouped together below. Equality fields are listed first, followed by range fields and then explicit ordering fields. For equality-only composites, ascending order is used in the deployable index definition.

| Collection | Fields (in order) | Query Scope | Used For | Source File |
|---|---|---|---|---|
| `sales` | `buyerUid` (==), `createdAt` (desc) | Collection group | Buyer marketplace order history and admin user purchase history | `users/js/marketplace-orders.js:47`; `safpedia concept admin dashboard/assets/js/admin.js:981` |
| `sales` | `vendorUid` (==), `createdAt` (desc) | Collection group | Vendor sales history and admin vendor detail sales | `api/vendors/[action].js:423`; `safpedia concept admin dashboard/assets/js/admin-vendor-management.js:342` |
| `vendorProducts` | `vendorUid` (==), `isActive` (==), `createdAt` (desc) | Collection | Public storefront product listing | `api/marketplace/[action].js:88` |
| `vendorProducts` | `vendorUid` (==), `isActive` (==) | Collection | Active-product count for product creation and vendor operations | `api/marketplace/[action].js:111`; `api/admin/marketplace/[action].js:229`; `api/cron/expire-vendor-subscriptions.js:28` |
| `vendorProducts` | `vendorUid` (==), `subscriptionLapsed` (==) | Collection | Reactivate products after payment or an admin subscription override | `api/admin/marketplace/[action].js:287`; `api/marketplace/webhook.js:340` |
| `courses` | `isPublished` (==), `createdAt` (desc) | Collection | Public course catalog ordered by newest | `pages/js/category-catalog.js:45`; `favicon/js/courses.js:38`; `js/course.js:40` |
| `courses` | `isPublished` (==), `category` (==), `createdAt` (desc) | Collection | Filtered course catalog by category, ordered by newest | `favicon/js/courses.js:157` |
| `courses` | `isPublished` (==), `category` (==) | Collection | Filtered course queries without explicit ordering | `favicon/js/new-course.js:374` |
| `vendorProducts` | `isActive` (==), `createdAt` (desc) | Collection | Public marketplace product catalog ordered by newest | `js/marketplace-store.js:47` |
| `vendorProducts` | `category` (==), `isActive` (==) | Collection | Category storefront listing filtered by category and active state | `pages/js/category-store.js:63` |
| `vendors` | `subscriptionStatus` (==), `subscriptionExpiresAt` (<) | Collection | Scheduled subscription expiry scan | `api/cron/expire-vendor-subscriptions.js:23` |
| `affiliates` | `code` (==), `status` (==) | Collection | Validate an affiliate referral code is approved | `api/paystack/create-transaction.js:50` |
| `adminAuditLog` | `vendorUid` (==), `createdAt` (desc) | Collection | Admin audit trail filtered to one vendor | `api/admin/marketplace/[action].js:318` |

## Notes on Scope and Redundancy

- The `sales` collection-group indexes are shared by the buyer and vendor query call sites with the same filter/order shape.
- The `courses` index with `isPublished`, `category`, and `createdAt` is distinct from the two-field `isPublished` + `category` equality-only query; the three-field index does not remove the need for the equality-only query in all Firestore query plans.
- The `vendorProducts` index with `vendorUid`, `isActive`, and `createdAt` is distinct from the equality-only `vendorUid` + `isActive` shape.
- `api/disputes/[action].js` currently performs duplicate checking with a `reference`-only query and an in-memory status check, so it does not require a composite index.
- Queries such as `collectionGroup('sales').where('reference', '==', ...)`, `collectionGroup('vendorPayoutRequests').where('reference', '==', ...)`, and `collectionGroup('subscriptionPayments').where('reference', '==', ...)` use a single equality filter and therefore do not require a composite index.

## firestore.indexes.json

```json
{
  "indexes": [
    {
      "collectionGroup": "sales",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "buyerUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "sales",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "vendorUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "vendorProducts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "vendorUid", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "vendorProducts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "vendorUid", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "vendorProducts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "vendorUid", "order": "ASCENDING" },
        { "fieldPath": "subscriptionLapsed", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "courses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isPublished", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "courses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isPublished", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "courses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isPublished", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "vendorProducts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "vendorProducts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "vendors",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "subscriptionStatus", "order": "ASCENDING" },
        { "fieldPath": "subscriptionExpiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "affiliates",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "code", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "adminAuditLog",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "vendorUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

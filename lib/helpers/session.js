"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredSessions = exports.storeDealIdsForPage = exports.createSessionWithPages = exports.getDealIdsForPage = exports.getSentDealIds = exports.validateSession = exports.createSession = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
// Initialize Firebase Admin if not already initialized
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
const SESSIONS_COLLECTION = "deal_sessions";
const SESSION_TTL_HOURS = 24; // Sessions expire after 24 hours
/**
 * Creates a new session in Firestore
 */
const createSession = async (sessionId) => {
    const now = firestore_1.Timestamp.now();
    const expiresAt = firestore_1.Timestamp.fromMillis(now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000));
    const sessionData = {
        sessionId,
        createdAt: now,
        expiresAt,
        pages: {},
    };
    await db.collection(SESSIONS_COLLECTION).doc(sessionId).set(sessionData);
};
exports.createSession = createSession;
/**
 * Validates if a session exists and is not expired
 */
const validateSession = async (sessionId) => {
    try {
        const sessionDoc = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();
        if (!sessionDoc.exists) {
            return false;
        }
        const sessionData = sessionDoc.data();
        const now = firestore_1.Timestamp.now();
        // Check if session is expired
        if (sessionData.expiresAt.toMillis() < now.toMillis()) {
            // Delete expired session
            await db.collection(SESSIONS_COLLECTION).doc(sessionId).delete();
            return false;
        }
        return true;
    }
    catch (error) {
        console.error("Error validating session:", error);
        return false;
    }
};
exports.validateSession = validateSession;
/**
 * Gets all deal IDs that have been sent for a session across all pages
 */
const getSentDealIds = async (sessionId) => {
    try {
        const sessionDoc = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();
        if (!sessionDoc.exists) {
            return new Set();
        }
        const sessionData = sessionDoc.data();
        const sentDealIds = new Set();
        // Collect all deal IDs from all pages
        Object.values(sessionData.pages || {}).forEach((dealIds) => {
            dealIds.forEach((dealId) => sentDealIds.add(dealId));
        });
        return sentDealIds;
    }
    catch (error) {
        console.error("Error getting sent deal IDs:", error);
        return new Set();
    }
};
exports.getSentDealIds = getSentDealIds;
/**
 * Gets deal IDs for a specific page from an existing session
 * Reads from subcollection: deal_sessions/{sessionId}/pages/{pageNumber}
 */
const getDealIdsForPage = async (sessionId, page) => {
    try {
        const startTime = Date.now();
        // First validate session exists and is not expired
        const sessionDoc = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();
        if (!sessionDoc.exists) {
            console.log(`Session ${sessionId} not found`);
            return null;
        }
        const sessionData = sessionDoc.data();
        const now = firestore_1.Timestamp.now();
        // Check if session is expired
        if (sessionData.expiresAt.toMillis() < now.toMillis()) {
            console.log(`Session ${sessionId} has expired`);
            // Optionally delete expired session
            await db.collection(SESSIONS_COLLECTION).doc(sessionId).delete();
            return null;
        }
        // Read page document from subcollection
        const pageDoc = await db
            .collection(SESSIONS_COLLECTION)
            .doc(sessionId)
            .collection("pages")
            .doc(String(page))
            .get();
        if (!pageDoc.exists) {
            console.log(`Page ${page} not found in session ${sessionId}`);
            return null;
        }
        const pageData = pageDoc.data();
        const dealIds = (pageData === null || pageData === void 0 ? void 0 : pageData.dealIds) || null;
        const duration = Date.now() - startTime;
        console.log(`Firestore page read completed in ${duration}ms`, {
            sessionId,
            page,
            dealIdsCount: (dealIds === null || dealIds === void 0 ? void 0 : dealIds.length) || 0,
        });
        return dealIds;
    }
    catch (error) {
        console.error("Error reading page from session:", error);
        return null;
    }
};
exports.getDealIdsForPage = getDealIdsForPage;
/**
 * Creates a session with all pages at once using Firestore batch writes for subdocuments
 * Uses batch write to efficiently write base document and all page subdocuments
 * @param sessionId - Unique session identifier
 * @param pages - Record mapping page numbers to arrays of deal IDs
 * @param totalItems - Total number of items (deals) in the session across all pages
 */
const createSessionWithPages = async (sessionId, pages, totalItems) => {
    try {
        const startTime = Date.now();
        const now = firestore_1.Timestamp.now();
        const expiresAt = firestore_1.Timestamp.fromMillis(now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000));
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        const pageEntries = Object.entries(pages);
        const BATCH_LIMIT = 500; // Firestore batch limit
        // Calculate totalItems if not provided
        const calculatedTotalItems = totalItems !== undefined ?
            totalItems :
            Object.values(pages).reduce((sum, pageDeals) => sum + pageDeals.length, 0);
        // Use Firestore batch write for better performance
        // Create base document and page subdocuments in a single batch
        if (pageEntries.length <= BATCH_LIMIT - 1) {
            // All pages fit in one batch (minus 1 for base document)
            const batch = db.batch();
            // Create base document with metadata including totalItems
            batch.set(sessionRef, {
                sessionId,
                createdAt: now,
                expiresAt,
                totalItems: calculatedTotalItems,
            });
            // Write each page as a subcollection document for better performance
            // Structure: deal_sessions/{sessionId}/pages/{pageNumber}
            const pagesRef = sessionRef.collection("pages");
            pageEntries.forEach(([pageNum, dealIds]) => {
                batch.set(pagesRef.doc(pageNum), {
                    page: Number(pageNum),
                    dealIds: dealIds,
                });
            });
            // Commit all writes in one batch operation
            await batch.commit();
        }
        else {
            // Too many pages - split into multiple batches
            // First batch: base document + first set of pages
            let firstBatch = db.batch();
            firstBatch.set(sessionRef, {
                sessionId,
                createdAt: now,
                expiresAt,
                totalItems: calculatedTotalItems,
            });
            const pagesRef = sessionRef.collection("pages");
            let batchOpCount = 1; // Base document
            for (const [pageNum, dealIds] of pageEntries) {
                if (batchOpCount >= BATCH_LIMIT) {
                    // Commit current batch and start new one
                    await firstBatch.commit();
                    firstBatch = db.batch();
                    batchOpCount = 0;
                }
                firstBatch.set(pagesRef.doc(pageNum), {
                    page: Number(pageNum),
                    dealIds: dealIds,
                });
                batchOpCount++;
            }
            // Commit final batch
            if (batchOpCount > 0) {
                await firstBatch.commit();
            }
        }
        const duration = Date.now() - startTime;
        const pagesCount = pageEntries.length;
        console.log(`Firestore session write completed in ${duration}ms`, {
            sessionId,
            pagesCount,
            totalDealIds: Object.values(pages).reduce((sum, pageDeals) => sum + pageDeals.length, 0),
            writeMethod: "batch_with_subcollections",
        });
    }
    catch (error) {
        console.error("Error creating session with pages:", error);
        throw error;
    }
};
exports.createSessionWithPages = createSessionWithPages;
/**
 * Stores deal IDs for a specific page in a session
 */
const storeDealIdsForPage = async (sessionId, page, dealIds) => {
    try {
        const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
        // Use Firestore transaction to ensure atomicity
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) {
                // Create session if it doesn't exist
                const now = firestore_1.Timestamp.now();
                const expiresAt = firestore_1.Timestamp.fromMillis(now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000));
                transaction.set(sessionRef, {
                    sessionId,
                    createdAt: now,
                    expiresAt,
                    pages: { [page]: dealIds },
                });
            }
            else {
                // Update existing session
                const sessionData = sessionDoc.data();
                const updatedPages = Object.assign(Object.assign({}, sessionData.pages), { [page]: dealIds });
                transaction.update(sessionRef, {
                    pages: updatedPages,
                });
            }
        });
    }
    catch (error) {
        console.error("Error storing deal IDs for page:", error);
        // Don't throw - allow the request to continue even if Firestore fails
    }
};
exports.storeDealIdsForPage = storeDealIdsForPage;
/**
 * Cleans up expired sessions (can be called periodically)
 */
const cleanupExpiredSessions = async () => {
    try {
        const now = firestore_1.Timestamp.now();
        const expiredSessions = await db
            .collection(SESSIONS_COLLECTION)
            .where("expiresAt", "<", now)
            .get();
        const batch = db.batch();
        expiredSessions.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        return expiredSessions.size;
    }
    catch (error) {
        console.error("Error cleaning up expired sessions:", error);
        return 0;
    }
};
exports.cleanupExpiredSessions = cleanupExpiredSessions;
//# sourceMappingURL=session.js.map
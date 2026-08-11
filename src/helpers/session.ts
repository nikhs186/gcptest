import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore, Timestamp, Transaction, QueryDocumentSnapshot} from "firebase-admin/firestore";

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const SESSIONS_COLLECTION = "deal_sessions";
const SESSION_TTL_HOURS = 24; // Sessions expire after 24 hours

interface SessionData {
  sessionId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  pages: Record<number, string[]>; // page number -> array of deal IDs
}

/**
 * Creates a new session in Firestore
 */
export const createSession = async (sessionId: string): Promise<void> => {
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(
    now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000),
  );

  const sessionData: SessionData = {
    sessionId,
    createdAt: now,
    expiresAt,
    pages: {},
  };

  await db.collection(SESSIONS_COLLECTION).doc(sessionId).set(sessionData);
};

/**
 * Validates if a session exists and is not expired
 */
export const validateSession = async (sessionId: string): Promise<boolean> => {
  try {
    const sessionDoc = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();

    if (!sessionDoc.exists) {
      return false;
    }

    const sessionData = sessionDoc.data() as SessionData;
    const now = Timestamp.now();

    // Check if session is expired
    if (sessionData.expiresAt.toMillis() < now.toMillis()) {
      // Delete expired session
      await db.collection(SESSIONS_COLLECTION).doc(sessionId).delete();
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error validating session:", error);
    return false;
  }
};

/**
 * Gets all deal IDs that have been sent for a session across all pages
 */
export const getSentDealIds = async (sessionId: string): Promise<Set<string>> => {
  try {
    const sessionDoc = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();

    if (!sessionDoc.exists) {
      return new Set<string>();
    }

    const sessionData = sessionDoc.data() as SessionData;
    const sentDealIds = new Set<string>();

    // Collect all deal IDs from all pages
    Object.values(sessionData.pages || {}).forEach((dealIds) => {
      dealIds.forEach((dealId) => sentDealIds.add(dealId));
    });

    return sentDealIds;
  } catch (error) {
    console.error("Error getting sent deal IDs:", error);
    return new Set<string>();
  }
};

/**
 * Gets deal IDs for a specific page from an existing session
 * Reads from subcollection: deal_sessions/{sessionId}/pages/{pageNumber}
 */
export const getDealIdsForPage = async (
  sessionId: string,
  page: number,
): Promise<string[] | null> => {
  try {
    const startTime = Date.now();

    // First validate session exists and is not expired
    const sessionDoc = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();

    if (!sessionDoc.exists) {
      console.log(`Session ${sessionId} not found`);
      return null;
    }

    const sessionData = sessionDoc.data() as SessionData;
    const now = Timestamp.now();

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
    const dealIds = pageData?.dealIds || null;

    const duration = Date.now() - startTime;
    console.log(`Firestore page read completed in ${duration}ms`, {
      sessionId,
      page,
      dealIdsCount: dealIds?.length || 0,
    });

    return dealIds;
  } catch (error) {
    console.error("Error reading page from session:", error);
    return null;
  }
};

/**
 * Creates a session with all pages at once using Firestore batch writes for subdocuments
 * Uses batch write to efficiently write base document and all page subdocuments
 * @param sessionId - Unique session identifier
 * @param pages - Record mapping page numbers to arrays of deal IDs
 * @param totalItems - Total number of items (deals) in the session across all pages
 */
export const createSessionWithPages = async (
  sessionId: string,
  pages: Record<number, string[]>,
  totalItems?: number,
): Promise<void> => {
  try {
    const startTime = Date.now();
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000),
    );

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
    } else {
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
  } catch (error) {
    console.error("Error creating session with pages:", error);
    throw error;
  }
};

/**
 * Stores deal IDs for a specific page in a session
 */
export const storeDealIdsForPage = async (
  sessionId: string,
  page: number,
  dealIds: string[],
): Promise<void> => {
  try {
    const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);

    // Use Firestore transaction to ensure atomicity
    await db.runTransaction(async (transaction: Transaction) => {
      const sessionDoc = await transaction.get(sessionRef);

      if (!sessionDoc.exists) {
        // Create session if it doesn't exist
        const now = Timestamp.now();
        const expiresAt = Timestamp.fromMillis(
          now.toMillis() + (SESSION_TTL_HOURS * 60 * 60 * 1000),
        );

        transaction.set(sessionRef, {
          sessionId,
          createdAt: now,
          expiresAt,
          pages: {[page]: dealIds},
        });
      } else {
        // Update existing session
        const sessionData = sessionDoc.data() as SessionData;
        const updatedPages = {
          ...sessionData.pages,
          [page]: dealIds,
        };

        transaction.update(sessionRef, {
          pages: updatedPages,
        });
      }
    });
  } catch (error) {
    console.error("Error storing deal IDs for page:", error);
    // Don't throw - allow the request to continue even if Firestore fails
  }
};

/**
 * Cleans up expired sessions (can be called periodically)
 */
export const cleanupExpiredSessions = async (): Promise<number> => {
  try {
    const now = Timestamp.now();
    const expiredSessions = await db
      .collection(SESSIONS_COLLECTION)
      .where("expiresAt", "<", now)
      .get();

    const batch = db.batch();
    expiredSessions.docs.forEach((doc: QueryDocumentSnapshot) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return expiredSessions.size;
  } catch (error) {
    console.error("Error cleaning up expired sessions:", error);
    return 0;
  }
};


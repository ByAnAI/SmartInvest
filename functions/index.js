const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

/**
 * Cloud Function to delete a user's Auth account and Firestore data.
 * This is necessary because client-side SDK cannot delete other users.
 */
exports.deleteUserAccount = functions.https.onCall(async (data, context) => {
    // 1. Security Check: Only authenticated users can call this
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "The function must be called while authenticated."
        );
    }

    // 2. Authorization Check: Only admins can delete users
    const callerUid = context.auth.uid;
    const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
    const callerData = callerDoc.data();

    if (!callerData || callerData.role !== "admin") {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Only administrative sessions can trigger a purge."
        );
    }

    const targetUid = data.uid;
    if (!targetUid) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "The function must be called with a target UID."
        );
    }

    try {
        // 3. Delete from Firebase Authentication (Catch error if user already deleted)
        try {
            await admin.auth().deleteUser(targetUid);
        } catch (authError) {
            if (authError.code !== 'auth/user-not-found') {
                throw authError;
            }
            console.log(`User ${targetUid} already removed from Auth.`);
        }

        // 4. Delete from Firestore
        await admin.firestore().collection("users").doc(targetUid).delete();

        // Optional: Delete other sub-collections if they exist (portfolio, files, etc.)
        // For a thorough deletion, you would also purge users/${targetUid}/portfolio, etc.

        return { success: true, message: `Identity ${targetUid} has been purged from Auth and Registry.` };
    } catch (error) {
        console.error("Purge Error:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

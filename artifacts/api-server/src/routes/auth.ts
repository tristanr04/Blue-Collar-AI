import { clerkClient } from "@clerk/express";
import { Router, type IRouter } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/auth/me", requireAuthenticatedUser, async (req: AuthenticatedRequest, res) => {
  const userId = req.authenticatedUserId!;

  try {
    const user = await clerkClient.users.getUser(userId);
    const primaryEmail = user.emailAddresses.find(
      (email) => email.id === user.primaryEmailAddressId,
    )?.emailAddress ?? null;

    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      email: primaryEmail,
    });
  } catch {
    res.status(502).json({
      stage: "authentication_provider",
      error: "Unable to load your account right now.",
    });
  }
});

export default router;

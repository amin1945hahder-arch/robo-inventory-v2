import { Button } from "@/components/ui/button";
import { LoadingGifInline } from "@/components/LoadingGif";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import {
  api,
} from "@/convex/_generated/api";
import { useMutation } from "convex/react";import { clearSavedAccount,
  getSavedAccount,
  saveAccount,
  type SavedAccount,
} from "@/lib/tokens";
import { signInWithRetry } from "@/lib/sign-in";
import { ArrowRight, Loader2, LogIn, Mail, X } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, user, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saved fast sign-in for this device ("Continue as Amin").
  const [saved, setSaved] = useState<SavedAccount | null>(() => getSavedAccount());
  const issueToken = useMutation(api.deviceTokens.issueDeviceToken);
  const whoAmI = useMutation(api.deviceTokens.whoAmIToken);

  // Self-heal the chip: drop tokens the server no longer knows, and refresh
  // the stored name/avatar (the local copy starts as the email prefix).
  useEffect(() => {
    const current = getSavedAccount();
    if (!current) return;
    let alive = true;
    void whoAmI({ token: current.token })
      .then((profile) => {
        if (!alive) return;
        if (!profile) {
          clearSavedAccount();
          setSaved(null);
          return;
        }
        const refreshed: SavedAccount = {
          ...current,
          name: profile.name || current.name,
          email: profile.email || current.email,
          image: profile.image,
          role: profile.role,
        };
        saveAccount(refreshed);
        setSaved(refreshed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quickSignIn = async () => {
    if (!saved) return;
    setIsLoading(true);
    setError(null);
    try {
      await signInWithRetry(signIn, "device", { token: saved.token });
      navigate(redirect);
    } catch {
      // Token no longer valid (revoked / database reset) — drop the chip.
      // Connection losses were already retried by signInWithRetry, so a
      // failure reaching here is a genuine rejection.
      clearSavedAccount();
      setSaved(null);
      setIsLoading(false);
      setError("This saved sign-in no longer works — sign in with your email instead.");
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      // New members without an approved profile go to /profile first —
      // until they fill their data (and an admin approves) they are
      // effectively read-only, so the profile is their landing page.
      const hasData = Boolean(user?.name && (user?.studentId || user?.phone));
      const grandfathered = user?.profileApproved === undefined && hasData;
      const lockedMember =
        user &&
        !user.isAnonymous &&
        user.role !== "admin" &&
        user.profileApproved !== true &&
        !grandfathered;
      navigate(lockedMember ? "/profile" : redirect);
    }
  }, [authLoading, isAuthenticated, user, navigate, redirect]);
  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      // Retries transient Convex connection drops ("Connection lost while
      // action was in flight") — a real rejection surfaces immediately.
      await signInWithRetry(signIn, "email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const email = String(formData.get("email") ?? "");
      // Same retry shield: a dropped connection mid-verification no longer
      // kills the flow; the still-valid code is simply re-verified.
      await signInWithRetry(signIn, "email-otp", formData);

      // Remember this device: issue a token so the next sign-in on this
      // browser skips the email code entirely ("Continue as …" chip).
      try {
        const { token } = await issueToken({});
        const account: SavedAccount = {
          token,
          name: email.split("@")[0] || email,
          email,
          savedAt: Date.now(),
        };
        saveAccount(account);
        setSaved(account);
      } catch {
        // Non-fatal: quick sign-in just won't be available on this device.
      }

      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);

      // Retries already happened for connection drops — anything reaching
      // here is (almost always) a genuinely wrong code.
      const msg = error instanceof Error ? error.message : "";
      setError(
        msg && !/connection|in flight/i.test(msg)
          ? msg
          : "The verification code you entered is incorrect.",
      );
      setIsLoading(false);

      setOtp("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">

      
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
        <Card className="min-w-[350px] pb-0">
          {step === "signIn" ? (
            <>
              <CardHeader className="text-center">
              <div className="flex justify-center">
                    <img
                      src={logo}
                      alt="Lock Icon"
                      width={64}
                      height={64}
                      className="rounded-lg mb-4 mt-4 cursor-pointer"
                      onClick={() => navigate("/")}
                    />
                  </div>
                <CardTitle className="text-xl">Get Started</CardTitle>
                <CardDescription>
                  Enter your email to log in or sign up
                </CardDescription>
              </CardHeader>
              {saved && !isLoading && (
                <div className="mx-6 mb-1 flex items-center gap-3 glass-3d rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <Avatar className="size-8 border">
                    <AvatarImage src={saved.image} />
                    <AvatarFallback className="text-xs font-semibold">
                      {(saved.name || saved.email || "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{saved.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{saved.email}</p>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void quickSignIn()}
                    disabled={isLoading}
                  >
                    <LogIn className="size-3.5" />
                    Continue
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    title="Forget this saved sign-in on this device"
                    onClick={() => {
                      clearSavedAccount();
                      setSaved(null);
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
              <form onSubmit={handleEmailSubmit}>
                <CardContent>
                  
                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        className="pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <LoadingGifInline size={18} className="h-4 w-4" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {error && (
                    <p className="mt-2 text-sm text-red-500">{error}</p>
                  )}
                  
                </CardContent>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="text-center mt-4">
                <CardTitle>Check your email</CardTitle>
                <CardDescription>
                  We've sent a code to {step.email}
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleOtpSubmit}>
                <CardContent className="pb-4">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          // Find the closest form and submit it
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p className="mt-2 text-sm text-red-500 text-center">
                      {error}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    Didn't receive a code?{" "}
                    <Button
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => setStep("signIn")}
                    >
                      Try again
                    </Button>
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <LoadingGifInline size={18} className="mr-2 h-4 w-4" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                    className="w-full"
                  >
                    Use different email
                  </Button>
                </CardFooter>
              </form>
            </>
          )}

          <div className="py-4 px-6 text-xs text-center text-muted-foreground bg-muted border-t rounded-b-lg">
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              freebuff.com
            </a>
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}

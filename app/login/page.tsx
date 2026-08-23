import Link from "next/link";
import { login, signup } from "./actions";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const signupMode = params.mode === "signup";
  const checkEmail = params.check_email === "1";
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <div className="form-shell">
      <Link href="/" className="brand">ProjectSignal</Link>
      <div className="panel" style={{marginTop:24}}>
        <h2>{signupMode ? "Create your account" : "Welcome back"}</h2>
        <p className="muted">
          {signupMode
            ? "Set up your business, territory and £79/month plan."
            : "Log in to see your latest matched opportunities."}
        </p>

        {checkEmail && <div className="notice">Check your email to confirm your ProjectSignal account.</div>}
        {error && <div className="notice error">{error}</div>}

        <form className="form" style={{marginTop:20}}>
          {signupMode && (
            <div className="field">
              <label htmlFor="full_name">Your name</label>
              <input id="full_name" name="full_name" required />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" minLength={8} autoComplete={signupMode ? "new-password" : "current-password"} required />
          </div>
          <button className="btn block" formAction={signupMode ? signup : login}>
            {signupMode ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="muted" style={{fontSize:13,marginBottom:0,marginTop:18}}>
          {signupMode ? (
            <>Already have an account? <Link href="/login"><strong>Log in</strong></Link></>
          ) : (
            <>New to ProjectSignal? <Link href="/login?mode=signup"><strong>Create an account</strong></Link></>
          )}
        </p>
      </div>
    </div>
  );
}

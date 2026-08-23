import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <div className="container">
        <nav className="nav">
          <Link href="/" className="brand">ProjectSignal</Link>
          <div className="navlinks">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <Link href="/login">Log in</Link>
            <Link className="btn" href="/login?mode=signup">Start finding projects</Link>
          </div>
        </nav>

        <main>
          <section className="hero">
            <div>
              <div className="eyebrow">Planning intelligence for local businesses</div>
              <h1>Find the project before your competitor does.</h1>
              <p className="lede">
                ProjectSignal scans local planning applications every day, scores
                the projects worth chasing and delivers the best opportunities
                directly to your business.
              </p>
              <div className="hero-actions">
                <Link className="btn accent" href="/login?mode=signup">Get ProjectSignal — £79/month</Link>
                <a className="btn secondary" href="#how">See how it works</a>
              </div>
              <p className="muted" style={{fontSize: 13, marginTop: 15}}>
                Launch niche: windows, doors & bifold installers.
              </p>
            </div>

            <div className="mock">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <strong>Today&apos;s opportunities</strong>
                <span className="muted">4 matched</span>
              </div>
              <div className="lead-card">
                <span className="score">9.3 / 10 · HOT</span>
                <h3 style={{marginTop:10}}>Two-storey rear extension</h3>
                <p className="muted" style={{margin:"5px 0"}}>LE11 · Planning application</p>
                <div className="value">£8k–£25k opportunity</div>
                <p style={{fontSize:13,marginBottom:0}}>Large extension with new glazing and doors. Contact early.</p>
              </div>
              <div className="lead-card">
                <span className="score">8.8 / 10 · HIGH</span>
                <h3 style={{marginTop:10}}>New residential dwelling</h3>
                <p className="muted" style={{margin:"5px 0"}}>LE12 · Planning application</p>
                <div className="value">£10k–£30k opportunity</div>
              </div>
            </div>
          </section>

          <section id="how" className="section">
            <div className="eyebrow">How it works</div>
            <h2>Raw planning data becomes a sales list.</h2>
            <div className="grid3" style={{marginTop:28}}>
              <div className="panel">
                <h3>1. We scan</h3>
                <p className="muted">New planning applications are imported from council feeds every morning.</p>
              </div>
              <div className="panel">
                <h3>2. We score</h3>
                <p className="muted">ProjectSignal removes irrelevant applications and scores the commercial opportunity for your trade.</p>
              </div>
              <div className="panel">
                <h3>3. You chase</h3>
                <p className="muted">Only projects inside your territory and above your minimum score reach your dashboard and email.</p>
              </div>
            </div>
          </section>

          <section id="pricing" className="section">
            <div className="panel" style={{maxWidth:640,margin:"0 auto",textAlign:"center",padding:36}}>
              <div className="eyebrow">ProjectSignal Pro</div>
              <h2 style={{marginTop:10}}>One good job can pay for the year.</h2>
              <div className="price">£79 <small>/ month</small></div>
              <p className="muted">Daily matched opportunities, lead scores, estimated values, territory filters and lead pipeline.</p>
              <Link className="btn accent" href="/login?mode=signup">Create your account</Link>
            </div>
          </section>
        </main>
      </div>
      <footer className="footer">
        <div className="container">ProjectSignal · UK planning opportunity intelligence</div>
      </footer>
    </>
  );
}

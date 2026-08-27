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
              <div className="eyebrow">For window, door and glazing installers</div>
              <h1>Find building projects before your competitors do.</h1>
              <p className="lede">
                ProjectSignal finds planning applications likely to need your services,
                ranks the best opportunities and gives you a simple sales pipeline to
                contact, quote and follow up.
              </p>
              <div className="hero-actions">
                <Link className="btn accent" href="/login?mode=signup">Start finding opportunities</Link>
                <a className="btn secondary" href="#how">See how it works</a>
              </div>
              <p className="muted" style={{fontSize: 13, marginTop: 15}}>
                £79/month · three counties included · cancel through Stripe
              </p>
            </div>

            <div className="mock">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <strong>Today&apos;s opportunities</strong>
                <span className="muted">4 matched</span>
              </div>
              <div className="lead-card">
                <span className="score">HOT</span>
                <h3 style={{marginTop:10}}>Two-storey rear extension</h3>
                <p className="muted" style={{margin:"5px 0"}}>LE11 · Planning application</p>
                <div className="value">£8k–£25k opportunity</div>
                <p style={{fontSize:13,marginBottom:0}}>Large extension with new glazing and doors. Contact early.</p>
              </div>
              <div className="lead-card">
                <span className="score">HIGH</span>
                <h3 style={{marginTop:10}}>New residential dwelling</h3>
                <p className="muted" style={{margin:"5px 0"}}>LE12 · Planning application</p>
                <div className="value">£10k–£30k opportunity</div>
              </div>
            </div>
          </section>

          <section id="how" className="section">
            <div className="eyebrow">How it works</div>
            <h2>From new planning application to won work.</h2>
            <div className="grid3" style={{marginTop:28}}>
              <div className="panel">
                <h3>1. Find opportunities</h3>
                <p className="muted">ProjectSignal monitors new planning applications across your selected counties every day.</p>
              </div>
              <div className="panel">
                <h3>2. Prioritise the best</h3>
                <p className="muted">Clear HOT, HIGH and MEDIUM priorities help you focus on projects most likely to need windows, doors or glazing.</p>
              </div>
              <div className="panel">
                <h3>3. Manage your pipeline</h3>
                <p className="muted">Review, contact, quote and follow up in one lightweight CRM, then record won work and measure your return.</p>
              </div>
            </div>
          </section>

          <section id="pricing" className="section">
            <div className="panel" style={{maxWidth:640,margin:"0 auto",textAlign:"center",padding:36}}>
              <div className="eyebrow">ProjectSignal Pro</div>
              <h2 style={{marginTop:10}}>One good job can pay for the year.</h2>
              <div className="price">£79 <small>/ month</small></div>
              <p className="muted"><strong>Three England counties included.</strong> Billed monthly through Stripe.</p>
              <ul className="feature-list">
                <li>Daily planning opportunity feed and priority ranking</li>
                <li>Estimated opportunity value and official application links</li>
                <li>Notes, follow-ups and contact history</li>
                <li>Quote pipeline and Won/Lost tracking</li>
                <li>Pipeline and confirmed-revenue ROI reporting</li>
              </ul>
              <p className="muted small-text">Additional counties are not yet available for self-service purchase.</p>
              <Link className="btn accent" href="/login?mode=signup">Start finding opportunities</Link>
            </div>
          </section>
        </main>
      </div>
      <footer className="footer">
        <div className="container footer-row">
          <span>ProjectSignal · Planning opportunities and a simple sales pipeline</span>
        </div>
      </footer>
    </>
  );
}

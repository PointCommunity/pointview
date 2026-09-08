import { connection } from "next/server";

export default async function HomePage() {
  await connection();
  return (
    <main id="main-content" className="shell">
      <header className="brand-bar" aria-label="PointView">
        <span className="brand-mark" aria-hidden="true">P</span>
        <span className="brand-name">PointView</span>
        <span className="environment-badge">Private</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Context stays attached</p>
        <h1 id="page-title">Feedback without the routing work.</h1>
        <p className="lede">
          Open PointView from a connected Point Community product. We verify where you came from, then you only
          provide the feedback and any screenshots that help explain it.
        </p>
        <div className="notice" role="status">
          <span className="status-dot" aria-hidden="true" />
          Waiting for a verified product launch
        </div>
      </section>

      <section className="feature-grid" aria-label="How PointView works">
        <article>
          <span className="step-number">01</span>
          <h2>Verified context</h2>
          <p>The source product, environment, page, and version arrive through a signed, single-use handoff.</p>
        </article>
        <article>
          <span className="step-number">02</span>
          <h2>Private intake</h2>
          <p>Your feedback and optional images stay private. Raw content is deleted after its retention window.</p>
        </article>
        <article>
          <span className="step-number">03</span>
          <h2>Careful triage</h2>
          <p>PointView researches current work and creates, enriches, or considers an Issue without starting development.</p>
        </article>
      </section>

      <footer>
        <p>Access is limited to approved Point Community accounts.</p>
      </footer>
    </main>
  );
}

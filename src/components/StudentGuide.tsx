/** Short student checklist — keep in sync with on-screen panels. */
export function StudentGuide() {
  return (
    <section className="card student-guide" aria-labelledby="student-guide-title">
      <h2 id="student-guide-title" className="student-guide-title">
        Quick steps
      </h2>
      <ol className="student-steps">
        <li>
          See where you are: <strong>R-###°</strong>, <strong>DME</strong>, and the map.
        </li>
        <li>
          <strong>IBOT</strong> — Inbound Bottom, Outbound Top: pick inbound or outbound, set the{' '}
          <strong>radial</strong> you want, set <strong>OBS</strong> to your course. Use <strong>TO / FR</strong> and the
          brown/blue map halves to check your side.
        </li>
        <li>
          Turn <strong>intercept angle</strong> above <strong>0°</strong> to show intercept lines on the map.
        </li>
        <li>
          Fly the heading in <strong>Intercept</strong> / <strong>INT HDG</strong> until the needle centers, then fly the
          steady heading shown there when you&apos;re on course.
        </li>
      </ol>
    </section>
  );
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useMentorData } from "../src/hooks/useMentorData";

function MentorDataLifecycleFixture() {
  const mentor = useMentorData();
  return (
    <main>
      <output data-testid="snapshot-date">{mentor.snapshot?.localDate ?? "loading"}</output>
      <output data-testid="workspace-date">
        {mentor.workspace?.referenceLocalDate ?? "loading"}
      </output>
      <output data-testid="workspace-count">
        {mentor.workspace?.entities.length ?? "loading"}
      </output>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MentorDataLifecycleFixture />
  </StrictMode>,
);

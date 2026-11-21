import { functions } from './functions.js';
import { layout, layoutPath, SplitLayout } from './Layout.js';
import './command.css';

/** The Terminal's own layout with its tabs named and its contents not loaded yet, so nothing moves when it arrives. */
export function TerminalSkeleton() {
  const { tree, slots } = layout;
  return (
    <div>
      <div className="term" aria-busy="true">
        <header className="cmd">
          <span className="home-link">HOME</span>
          <span className="caret" aria-hidden="true">
            &gt;
          </span>
        </header>
        <main className="layout">
          <SplitLayout
            node={tree}
            path={layoutPath}
            pane={(slot) => (
              <section className="pane">
                <header className="ph">
                  <div className="tabs">
                    {(slots[slot] ?? []).map((id, index) => (
                      <span key={id} className="skeleton-tab" data-first={index === 0 || undefined}>
                        {functions[id]}
                      </span>
                    ))}
                  </div>
                </header>
                <div className="skeleton-rows" />
              </section>
            )}
          />
        </main>
        <footer className="status-bar" />
        <span className="skeleton-status" role="status">
          Loading terminal…
        </span>
      </div>
    </div>
  );
}

export function mount(container) {
  container.innerHTML = `
    <div class="tracker-empty">
      <div class="empty-icon">◎</div>
      <p class="empty-title">Weight</p>
      <p class="empty-sub">Coming next.</p>
    </div>
  `;
}
export function unmount() {}
export function getContext() { return null; }

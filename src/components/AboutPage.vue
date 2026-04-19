<template>
  <div class="about-page">

    <!-- Hero -->
    <div class="about-hero">
      <h1 class="about-title">Clearbook</h1>
      <p class="about-tagline">A personal budget tracker that keeps your finances clear.</p>
    </div>

    <!-- Purpose -->
    <section class="about-section">
      <h2 class="about-section-title">What is Clearbook?</h2>
      <p class="about-body">
        Clearbook is a privacy-first, offline personal finance app that lives entirely in your browser.
        No accounts. No servers. No subscriptions. Your data stays in your browser's local storage and
        never leaves your device unless you choose to export it.
      </p>
      <p class="about-body">
        It follows the <strong>envelope budgeting</strong> philosophy — you define a set of budget line
        items each month, assign money to them, and then log transactions against those items to see
        exactly where your money is going.
      </p>
    </section>

    <!-- How to use -->
    <section class="about-section">
      <h2 class="about-section-title">How to Use</h2>
      <ol class="about-steps">
        <li class="about-step">
          <span class="about-step-num">1</span>
          <div>
            <strong>Build your Template</strong> — Go to <em>Template</em> and add the budget categories
            and line items that reflect your life (Rent, Groceries, Gym, Netflix…). This becomes your
            reusable starting point each month.
          </div>
        </li>
        <li class="about-step">
          <span class="about-step-num">2</span>
          <div>
            <strong>Set up Accounts</strong> — Head to <em>Accounts</em> and add your bank accounts,
            credit cards, or cash envelopes. Accounts let you track which pocket money is flowing
            through.
          </div>
        </li>
        <li class="about-step">
          <span class="about-step-num">3</span>
          <div>
            <strong>Open a Budget month</strong> — In <em>Budget</em>, pick a month and assign amounts
            to each line item. You can generate entries from your template in one click from Settings,
            or fill them in manually.
          </div>
        </li>
        <li class="about-step">
          <span class="about-step-num">4</span>
          <div>
            <strong>Log Transactions</strong> — Use the <em>Transactions</em> log to record every
            income and expense. Import a CSV from your bank, or add entries manually. Each transaction
            can be linked to a budget item and an account.
          </div>
        </li>
        <li class="about-step">
          <span class="about-step-num">5</span>
          <div>
            <strong>Assign &amp; Categorise</strong> — Click <em>Assign</em> on the Budget page to
            walk through unassigned transactions one at a time. Clearbook suggests categories based on
            past patterns and lets you browse or auto-assign in bulk.
          </div>
        </li>
        <li class="about-step">
          <span class="about-step-num">6</span>
          <div>
            <strong>Review Reports</strong> — The <em>Reports</em> page gives you spending summaries,
            category breakdowns, income vs. expense comparisons, and per-account balances across any
            time range you choose.
          </div>
        </li>
        <li class="about-step">
          <span class="about-step-num">7</span>
          <div>
            <strong>Backup your data</strong> — Use <em>Settings › Data › Export Backup</em> to
            download a single JSON file containing everything. Restore it at any time with Import
            Backup.
          </div>
        </li>
      </ol>
    </section>

    <!-- Key features -->
    <section class="about-section">
      <h2 class="about-section-title">Key Features</h2>
      <div class="about-features">
        <div class="about-feature">
          <i class="pi pi-lock about-feature-icon" />
          <div>
            <strong>100% local</strong>
            <p>All data lives in <code>localStorage</code>. Nothing is sent anywhere.</p>
          </div>
        </div>
        <div class="about-feature">
          <i class="pi pi-file-import about-feature-icon" />
          <div>
            <strong>CSV import</strong>
            <p>Paste or upload a bank export and bulk-add transactions in seconds.</p>
          </div>
        </div>
        <div class="about-feature">
          <i class="pi pi-sparkles about-feature-icon" />
          <div>
            <strong>Auto-categorisation</strong>
            <p>Pattern-matching suggests the right budget item based on transaction names.</p>
          </div>
        </div>
        <div class="about-feature">
          <i class="pi pi-palette about-feature-icon" />
          <div>
            <strong>Five themes</strong>
            <p>Dark, Light, Midnight, Forest, and Purple — pick what suits you.</p>
          </div>
        </div>
        <div class="about-feature">
          <i class="pi pi-globe about-feature-icon" />
          <div>
            <strong>Localisation</strong>
            <p>Full locale and currency support — formats dates and money your way.</p>
          </div>
        </div>
        <div class="about-feature">
          <i class="pi pi-download about-feature-icon" />
          <div>
            <strong>Export / Import</strong>
            <p>Back up everything to JSON and restore it on any device.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Tech stack -->
    <section class="about-section">
      <h2 class="about-section-title">Tech Stack</h2>
      <div class="about-stack">
        <div class="about-stack-item">
          <span class="about-stack-badge">Vue 3</span>
          <span class="about-stack-desc">Composition API + <code>&lt;script setup&gt;</code> throughout</span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">TypeScript</span>
          <span class="about-stack-desc">Strict typing on all stores, components, and utilities</span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">Pinia</span>
          <span class="about-stack-desc">State management — accounts, budget, transactions, settings, template</span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">Vite</span>
          <span class="about-stack-desc">Lightning-fast dev server and build tool</span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">Tailwind CSS v4</span>
          <span class="about-stack-desc">Utility-first styling with <code>@import "tailwindcss"</code></span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">PrimeVue 4</span>
          <span class="about-stack-desc">Aura preset — DataTable, Select, InputNumber, Checkbox, Dialog</span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">PrimeIcons</span>
          <span class="about-stack-desc">Icon set used throughout the UI</span>
        </div>
        <div class="about-stack-item">
          <span class="about-stack-badge">localStorage</span>
          <span class="about-stack-desc">Persistence layer — no backend, no database</span>
        </div>
      </div>
    </section>

    <!-- Seahorse -->
    <div class="about-seahorse">🦀</div>

  </div>
</template>

<style scoped>
.about-page {
  max-width: 52rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Hero */
.about-hero {
  padding: 2rem 0 1rem;
  border-bottom: 2px solid #d4d4d8;
}

.dark .about-hero {
  border-bottom-color: #3f3f46;
}

.about-title {
  font-size: 2.5rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: #18181b;
  line-height: 1;
  margin: 0 0 0.5rem;
}

.dark .about-title {
  color: #f4f4f5;
}

.about-tagline {
  font-size: 1rem;
  color: #71717a;
  margin: 0;
}

/* Sections */
.about-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.about-section-title {
  font-size: 0.65rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #27272a;
  background-color: #e4e4e7;
  border-bottom: 2px solid #d4d4d8;
  padding: 0.55rem 1rem;
  margin: 0;
}

.dark .about-section-title {
  color: #e4e4e7;
  background-color: #3f3f46;
  border-bottom-color: #52525b;
}

.about-body {
  font-size: 0.85rem;
  line-height: 1.7;
  color: #3f3f46;
  margin: 0;
  padding: 0 1rem;
}

.dark .about-body {
  color: #d4d4d8;
}

.about-body strong {
  color: #18181b;
}

.dark .about-body strong {
  color: #f4f4f5;
}

/* Steps */
.about-steps {
  list-style: none;
  margin: 0;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.about-step {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  font-size: 0.85rem;
  line-height: 1.6;
  color: #3f3f46;
}

.dark .about-step {
  color: #d4d4d8;
}

.about-step strong {
  color: #18181b;
}

.dark .about-step strong {
  color: #f4f4f5;
}

.about-step em {
  font-style: normal;
  font-weight: 700;
  color: #18181b;
}

.dark .about-step em {
  color: #e4e4e7;
}

.about-step-num {
  flex: 0 0 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 900;
  background: #18181b;
  color: #f4f4f5;
  border-radius: 0;
  margin-top: 0.05rem;
}

.dark .about-step-num {
  background: #e4e4e7;
  color: #18181b;
}

/* Features grid */
.about-features {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.75rem;
  padding: 0 1rem;
}

.about-feature {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 2px solid #e4e4e7;
  font-size: 0.82rem;
  line-height: 1.5;
}

.dark .about-feature {
  border-color: #3f3f46;
}

.about-feature-icon {
  font-size: 1.1rem;
  margin-top: 0.1rem;
  color: #71717a;
  flex-shrink: 0;
}

.about-feature strong {
  display: block;
  font-weight: 700;
  color: #18181b;
  margin-bottom: 0.15rem;
}

.dark .about-feature strong {
  color: #f4f4f5;
}

.about-feature p {
  margin: 0;
  color: #71717a;
}

/* Tech stack */
.about-stack {
  display: flex;
  flex-direction: column;
  padding: 0 1rem;
  border: 2px solid #e4e4e7;
}

.dark .about-stack {
  border-color: #3f3f46;
}

.about-stack-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #e4e4e7;
  font-size: 0.82rem;
}

.about-stack-item:last-child {
  border-bottom: none;
}

.dark .about-stack-item {
  border-bottom-color: #3f3f46;
}

.about-stack-badge {
  flex: 0 0 9rem;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #18181b;
  background: #e4e4e7;
  padding: 0.2rem 0.5rem;
  text-align: center;
}

.dark .about-stack-badge {
  background: #3f3f46;
  color: #e4e4e7;
}

.about-stack-desc {
  color: #52525b;
}

.dark .about-stack-desc {
  color: #a1a1aa;
}

code {
  font-family: ui-monospace, monospace;
  font-size: 0.8em;
  background: #e4e4e7;
  padding: 0.1em 0.3em;
}

.dark code {
  background: #3f3f46;
  color: #d4d4d8;
}

/* Seahorse */
.about-seahorse {
  text-align: center;
  font-size: 3.5rem;
  padding: 2rem 0 3rem;
  line-height: 1;
}
</style>

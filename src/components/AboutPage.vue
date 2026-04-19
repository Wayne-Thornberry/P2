<template>
  <div class="about-page">

    <!-- Hero -->
    <div class="about-hero">
      <h1 class="about-title">Clearbook</h1>
      <p class="about-tagline">A personal budget tracker that keeps your finances clear.</p>
      <span class="about-version">v1.0.0</span>
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
            <strong>Six themes</strong>
            <p>Light, Dark, Midnight, Forest, Purple, Rose, Slate, and Teal — pick what suits you.</p>
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

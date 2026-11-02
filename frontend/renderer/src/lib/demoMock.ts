/**
 * In-Browser Interactive Demo Mock Layer
 * 
 * Intercepts network calls when running in standalone demo mode (e.g. Vercel deployment
 * without an external backend), providing instant, rich, realistic retail & wholesale
 * datasets so the entire platform is 100% interactive and functional out-of-the-box.
 */

interface MockUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "wholesale" | "retail" | "retail_management" | "development";
  branch_id: string | null;
  branch_name: string | null;
}

const DEMO_USERS: Record<string, MockUser> = {
  "admin@branchwise.app": {
    id: "usr-admin",
    email: "admin@branchwise.app",
    name: "Admin User",
    role: "admin",
    branch_id: null,
    branch_name: null,
  },
  "wholesale@branchwise.app": {
    id: "usr-wholesale",
    email: "wholesale@branchwise.app",
    name: "Wholesale Manager",
    role: "wholesale",
    branch_id: "b-wh",
    branch_name: "Central Distribution Warehouse",
  },
  "downtown@branchwise.dev": {
    id: "usr-downtown",
    email: "downtown@branchwise.dev",
    name: "Downtown Flagship Staff",
    role: "retail",
    branch_id: "b-1",
    branch_name: "Downtown Flagship",
  },
  "central@branchwise.dev": {
    id: "usr-central",
    email: "central@branchwise.dev",
    name: "CentralStore Staff",
    role: "retail",
    branch_id: "b-2",
    branch_name: "CentralStore",
  },
};

const DEFAULT_USER: MockUser = DEMO_USERS["admin@branchwise.app"];
let currentUser: MockUser = DEFAULT_USER;

const DEMO_BRANCHES = [
  { id: "b-1", name: "Downtown Flagship", phone_number: "555-0101", address: "100 Commercial Avenue, Metro City" },
  { id: "b-2", name: "CentralStore", phone_number: "555-0102", address: "200 Central Parkway, Metro City" },
  { id: "b-3", name: "BranchAlpha", phone_number: "555-0103", address: "300 Alpha Boulevard, North District" },
  { id: "b-4", name: "WestMall", phone_number: "555-0104", address: "400 West Avenue, West End" },
];

const DEMO_SETTINGS = {
  stock_forward_fallback_window_days: 7,
  purchase_lookback_window_days: 30,
  stock_lookback_window_days: 30,
  theme: "light",
  sale_warning_window_days: 7,
  purchase_warning_window_days: 7,
  sale_list_window_days: 90,
  purchase_list_window_days: 90,
  show_buying_price_source: true,
  daily_check_cutoff_time: "21:00",
  branch_health_weights: {
    sales: 0.3,
    profit: 0.25,
    inventory: 0.2,
    customer: 0.15,
    data_quality: 0.1,
  },
  purchasing_buffer_months: { a: 1.5, b: 2.0, c: 3.0 },
  today_exchange_rates: { USD: "2100", THB: "65.5", CNY: "292" },
  wholesale_profit: { kind: "percent", value: 15 },
};

export function setupDemoMock(): void {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // Only intercept API calls
    if (!urlStr.includes("/api/")) {
      return originalFetch(input, init);
    }

    // Check if we have a real remote backend URL configured
    const configuredApiUrl = (import.meta.env.VITE_API_BASE_URL || "").trim();
    const hasLiveBackend = Boolean(configuredApiUrl && !configuredApiUrl.includes("your-backend") && !configuredApiUrl.includes("127.0.0.1") && !configuredApiUrl.includes("localhost"));

    if (hasLiveBackend) {
      try {
        const resp = await originalFetch(input, init);
        const cType = resp.headers.get("content-type") || "";
        if (resp.ok && cType.includes("application/json")) {
          return resp;
        }
      } catch {
        // Fall back to Mock
      }
    }

    // Mock response helper
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const method = (init?.method || "GET").toUpperCase();
    const url = new URL(urlStr, window.location.origin);
    const path = url.pathname;

    // 1. Auth & Me
    if (path.includes("/api/auth/login") || path.endsWith("/auth/login")) {
      let email = "admin@branchwise.app";
      try {
        if (init?.body) {
          const body = JSON.parse(init.body as string);
          if (body.email) email = body.email;
        }
      } catch {}
      currentUser = DEMO_USERS[email] || {
        id: "usr-custom",
        email: email,
        name: email.split("@")[0] || "Demo User",
        role: email.includes("wholesale") ? "wholesale" : "admin",
        branch_id: null,
        branch_name: null,
      };
      return json({
        access_token: "mock-jwt-token-" + currentUser.role,
        session: "mock-session-token",
        user: { id: currentUser.id, email: currentUser.email, name: currentUser.name },
      });
    }

    if (path.includes("/api/auth/logout") || path.endsWith("/auth/logout")) {
      currentUser = DEFAULT_USER;
      return json({ status: "ok" });
    }

    if (path.includes("/api/auth/refresh") || path.endsWith("/auth/refresh")) {
      return json({ access_token: "mock-jwt-token-" + currentUser.role, session: "mock-session-token" });
    }

    if (path.includes("/api/me") || path.endsWith("/me")) {
      return json(currentUser);
    }

    // 2. Health & Heartbeats
    if (path.includes("/api/health")) {
      return json({ status: "ok", database: "ok" });
    }

    // 3. Branches & Settings
    if (path.includes("/api/branches")) {
      return json(DEMO_BRANCHES);
    }

    if (path.includes("/api/settings/theme")) {
      return json({ theme: "light" });
    }

    if (path.includes("/api/settings")) {
      return json(DEMO_SETTINGS);
    }

    if (path.includes("/api/imports/data-version")) {
      return json({ version: 1 });
    }

    // 4. Retail Dashboard Overview & Summary
    if (path.includes("/api/dashboard/overview")) {
      return json({
        branch_id: "b-1",
        branch_name: "Downtown Flagship",
        date_from: "2026-10-01",
        date_to: "2026-10-31",
        previous_date_from: "2026-09-01",
        previous_date_to: "2026-09-30",
        overall_score: 88.5,
        status: "healthy",
        scored_weight: 1.0,
        dimensions: [
          {
            key: "sales",
            label: "Sales Velocity",
            description: "Revenue trajectory and growth vs prior window",
            weight: 0.3,
            effective_weight: 0.3,
            score: 92.0,
            status: "healthy",
            insufficient_data_reason: null,
            sub_metrics: [],
          },
          {
            key: "profit",
            label: "Gross Profit Margin",
            description: "Product markup and net margin retention",
            weight: 0.25,
            effective_weight: 0.25,
            score: 87.0,
            status: "healthy",
            insufficient_data_reason: null,
            sub_metrics: [],
          },
          {
            key: "inventory",
            label: "Stock Health",
            description: "Reconciliation discrepancy and turnover velocity",
            weight: 0.2,
            effective_weight: 0.2,
            score: 85.0,
            status: "healthy",
            insufficient_data_reason: null,
            sub_metrics: [],
          },
          {
            key: "customer",
            label: "Customer Volume",
            description: "Transaction density and basket size",
            weight: 0.15,
            effective_weight: 0.15,
            score: 89.0,
            status: "healthy",
            insufficient_data_reason: null,
            sub_metrics: [],
          },
          {
            key: "data_quality",
            label: "Import Freshness",
            description: "On-time daily POS uploads and audit alignment",
            weight: 0.1,
            effective_weight: 0.1,
            score: 95.0,
            status: "healthy",
            insufficient_data_reason: null,
            sub_metrics: [],
          },
        ],
        weights: {
          dimensions: DEMO_SETTINGS.branch_health_weights,
          sub_metrics: {},
          defaults: { dimensions: DEMO_SETTINGS.branch_health_weights, sub_metrics: {} },
          customised: false,
        },
        alerts: [
          {
            id: "alt-1",
            severity: "normal",
            dimension: "sales",
            title: "Weekend Sales Spike (+18.4%)",
            summary: "Downtown Flagship achieved higher than expected basket volume on Saturday.",
            what_happened: "Promotion campaign drove higher foot traffic across Footwear categories.",
            recommended_action: "Maintain current weekend staffing levels.",
            link: "revenue",
            measure: "sales_growth",
            context: "Current vs previous 7-day period",
            facts: [
              { label: "Net Revenue", value: "48,500,000 Ks", change: "+18.4%", tone: "good", direction: "up" },
              { label: "Transactions", value: "1,240 slips", change: "+14.2%", tone: "good", direction: "up" },
            ],
            table: null,
            evidence_days: 7,
          },
        ],
      });
    }

    if (path.includes("/api/dashboard/all-summary") || path.includes("/api/dashboard/summary")) {
      return json({
        total_revenue: { value: 48500000, previous_value: 41200000, delta_pct: 17.7 },
        total_profit: { value: 14200000, previous_value: 12100000, delta_pct: 17.3 },
        branches: [
          { branch_id: "b-1", branch_name: "Downtown Flagship", revenue: 21500000, profit: 6450000, margin_pct: 30.0 },
          { branch_id: "b-2", branch_name: "CentralStore", revenue: 14200000, profit: 4118000, margin_pct: 29.0 },
          { branch_id: "b-3", branch_name: "BranchAlpha", revenue: 8300000, profit: 2407000, margin_pct: 29.0 },
          { branch_id: "b-4", branch_name: "WestMall", revenue: 4500000, profit: 1225000, margin_pct: 27.2 },
        ],
      });
    }

    if (path.includes("/api/dashboard/all-revenue") || path.includes("/api/dashboard/revenue")) {
      return json({
        net_revenue: { value: 48500000, previous_value: 41200000, delta_pct: 17.7 },
        total_orders: { value: 1240, previous_value: 1086, delta_pct: 14.2 },
        average_basket: { value: 39112, previous_value: 37937, delta_pct: 3.1 },
        timeline: [
          { date: "2026-10-25", revenue: 6400000, orders: 164 },
          { date: "2026-10-26", revenue: 5900000, orders: 152 },
          { date: "2026-10-27", revenue: 6800000, orders: 178 },
          { date: "2026-10-28", revenue: 7200000, orders: 185 },
          { date: "2026-10-29", revenue: 6900000, orders: 176 },
          { date: "2026-10-30", revenue: 7800000, orders: 195 },
          { date: "2026-10-31", revenue: 7500000, orders: 190 },
        ],
      });
    }

    // 5. Retail Sales, Inventory & Purchases
    if (path.includes("/api/sales")) {
      return json({
        total: 1240,
        page: 1,
        page_size: 20,
        items: [
          {
            Branch: "Downtown Flagship",
            Date: "2026-10-31",
            Time: "14:23:10",
            SlipID: "SLP-261031-0089",
            SlipNumber: "89",
            LineNo: 1,
            LineID: "LN-89-1",
            StockCode: "SH-901-BLK",
            Description: "Classic Leather Loafer (Black / 42)",
            Selling_Price: 45000,
            Qty: 1,
            UOM: "pair",
            Discount_Amount: 0,
            Amount: 45000,
            Net_Amount: 45000,
            Location: "Downtown Flagship",
            Buying_Price: 31000,
            Buying_Price_Source: "PO-2609-012",
            Profit: 14000,
            Profit_Margin_Pct: 31.1,
          },
          {
            Branch: "Downtown Flagship",
            Date: "2026-10-31",
            Time: "15:02:44",
            SlipID: "SLP-261031-0092",
            SlipNumber: "92",
            LineNo: 1,
            LineID: "LN-92-1",
            StockCode: "SD-402-BRN",
            Description: "Comfort Slide Sandal (Brown / 41)",
            Selling_Price: 28000,
            Qty: 2,
            UOM: "pair",
            Discount_Amount: 2000,
            Amount: 56000,
            Net_Amount: 54000,
            Location: "Downtown Flagship",
            Buying_Price: 19000,
            Buying_Price_Source: "PO-2609-015",
            Profit: 16000,
            Profit_Margin_Pct: 29.6,
          },
          {
            Branch: "CentralStore",
            Date: "2026-10-31",
            Time: "16:15:20",
            SlipID: "SLP-261031-0054",
            SlipNumber: "54",
            LineNo: 1,
            LineID: "LN-54-1",
            StockCode: "SN-108-WHT",
            Description: "Lightweight Runner (White / 39)",
            Selling_Price: 38000,
            Qty: 1,
            UOM: "pair",
            Discount_Amount: 0,
            Amount: 38000,
            Net_Amount: 38000,
            Location: "CentralStore",
            Buying_Price: 26500,
            Buying_Price_Source: "PO-2609-018",
            Profit: 11500,
            Profit_Margin_Pct: 30.2,
          },
        ],
      });
    }

    // 6. Warnings & Alerts
    if (path.includes("/api/warnings")) {
      return json({
        inventory_mismatch_count: 0,
        sale_numeric_issues: 0,
        purchase_numeric_issues: 0,
        unit_mismatch_count: 0,
        missing_imports: [],
        warnings: [],
      });
    }

    // 7. Wholesale Dashboard & Orders
    if (path.includes("/api/wholesale/dashboard")) {
      return json({
        revenue_metrics: { total_orders_amount: 103800000, received_payments: 88400000, receivables: 15400000 },
        fulfillment: { total_orders: 42, delivered: 34, pending_shipment: 8 },
        top_customers: [
          { name: "Customer Alpha", amount: 32000000, share_pct: 30.8 },
          { name: "Customer Beta", amount: 24500000, share_pct: 23.6 },
          { name: "Customer Gamma", amount: 18200000, share_pct: 17.5 },
        ],
      });
    }

    if (path.includes("/api/wholesale/orders")) {
      return json([
        {
          id: "ord-1001",
          order_number: "ORD-2610-001",
          customer_name: "Customer Alpha",
          order_date: "2026-10-28",
          total_pairs: 120,
          total_amount: 5400000,
          status: "delivered",
          payment_status: "paid",
          delivery_location: "Downtown Gate",
        },
        {
          id: "ord-1002",
          order_number: "ORD-2610-002",
          customer_name: "Customer Beta",
          order_date: "2026-10-30",
          total_pairs: 80,
          total_amount: 3600000,
          status: "in_transit",
          payment_status: "partial",
          delivery_location: "Central Market",
        },
      ]);
    }

    // 8. AI Chat Assistant
    if (path.includes("/api/chat/frequent-topic")) {
      return json({ topic: "Sales Performance across branches today" });
    }

    if (path.includes("/api/chat")) {
      return json({
        id: "msg-demo",
        role: "assistant",
        content:
          "Hello! I am the **BranchWise Business Copilot**. Based on today's simulated retail data across your 4 active branches:\n\n" +
          "- **Total Revenue**: 48,500,000 Ks (+17.7% vs previous window)\n" +
          "- **Top Performing Branch**: Downtown Flagship (21,500,000 Ks, 30.0% margin)\n" +
          "- **Inventory Reconciliation**: 0 discrepancies detected across the latest snapshots.\n\n" +
          "What metric would you like to inspect next?",
      });
    }

    // Default fallback for any unspecified endpoint
    return json({ status: "ok", data: [], message: "Demo Mode Mock Response" });
  };
}

// Automatically activate when loaded
setupDemoMock();

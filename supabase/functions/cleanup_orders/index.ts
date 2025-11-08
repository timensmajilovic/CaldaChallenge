import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get orders older than 1 week
    const { data: oldOrders, error: ordersError } = await supabase
      .from("orders")
      .select("id, created_at")
      .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (ordersError) throw ordersError;
    if (!oldOrders || oldOrders.length === 0) {
      return new Response(JSON.stringify({ message: "No old orders to clean" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const orderIds = oldOrders.map((o: any) => o.id);

    // Aggregate totals per week
    const { data: totals, error: totalsError } = await supabase
      .from("order_items")
      .select("order_id, quantity, price_at_purchase")
      .in("order_id", orderIds);

    if (totalsError) throw totalsError;

    const weeklyTotals: Record<string, number> = {};

    totals.forEach((item: any) => {
      const order = oldOrders.find((o: any) => o.id === item.order_id);
      const weekKey = new Date(order.created_at).toISOString().slice(0, 10); // YYYY-MM-DD
      if (!weeklyTotals[weekKey]) weeklyTotals[weekKey] = 0;
      weeklyTotals[weekKey] += item.quantity * item.price_at_purchase;
    });

    // Insert weekly totals
    const insertTotals = Object.entries(weeklyTotals).map(([week, total]) => ({
      week,
      total_amount: total,
    }));

    const { error: insertTotalsError } = await supabase
      .from("weekly_order_totals")
      .insert(insertTotals);

    if (insertTotalsError) throw insertTotalsError;

    // Delete order items
    const { error: deleteItemsError } = await supabase
      .from("order_items")
      .delete()
      .in("order_id", orderIds);

    if (deleteItemsError) throw deleteItemsError;

    // Delete orders
    const { error: deleteOrdersError } = await supabase
      .from("orders")
      .delete()
      .in("id", orderIds);

    if (deleteOrdersError) throw deleteOrdersError;

    return new Response(JSON.stringify({ message: `Deleted ${orderIds.length} old orders` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

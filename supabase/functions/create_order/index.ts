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

    const body = await req.json();
    const { user_id, recipient_name, shipping_address, items } = body;

    if (!user_id || !recipient_name || !shipping_address || !Array.isArray(items)) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Start a transaction
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id,
        recipient_name,
        shipping_address,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const orderId = order.id;

    // Insert order items
    const orderItemsData = items.map((i: any) => ({
      order_id: orderId,
      item_id: i.item_id,
      quantity: i.quantity,
      price_at_purchase: 0, // will fetch current price below
    }));

    // Fetch current item prices
    const itemIds = items.map((i: any) => i.item_id);
    const { data: itemPrices, error: priceError } = await supabase
      .from("items")
      .select("id, price")
      .in("id", itemIds);

    if (priceError) throw priceError;

    const priceMap: Record<string, number> = {};
    itemPrices?.forEach((item: any) => (priceMap[item.id] = parseFloat(item.price)));

    orderItemsData.forEach((oi: any) => {
      oi.price_at_purchase = priceMap[oi.item_id] || 0;
    });

    const { data: insertedItems, error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItemsData)
      .select();

    if (itemsError) throw itemsError;

    // Calculate order total
    const total = orderItemsData.reduce(
      (sum: number, oi: any) => sum + oi.quantity * oi.price_at_purchase,
      0
    );

    return new Response(
      JSON.stringify({
        order,
        items: insertedItems,
        total,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

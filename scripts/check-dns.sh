#!/usr/bin/env bash
# winfit.mn-ийн DNS бичлэгийг ХҮЛЭЭГДЭЖ БУЙ утгатай тулгана.
#
#   ./check-dns.sh                      # нийтийн resolver-оор (одоогийн байдал)
#   ./check-dns.sh ada.ns.cloudflare.com   # Cloudflare-ийн серверээс ШУУД
#
# ⚠ Nameserver солихоос ӨМНӨ хоёр дахь хэлбэрээр ажиллуулна. Бүгд ✓
# болвол солих нь аюулгүй. Солисны дараа эхний хэлбэрээр дахин.
#
# ⚠ DKIM-д онцгой анхаарна: 216 тэмдэгтийн мөр таслагдвал мэйл
# ЧИМЭЭГҮЙ унана — сайт шалгахад мэдэгдэхгүй.
#
# ⚠ ЖАГСААЛТ НЬ БҮРЭН БАЙХ ЁСТОЙ. Эхэндээ 7 бичлэгтэй гэж үзсэн нь
# БУРУУ байв: нэрийг нь таамаглан асуусан тул `rsend` ба
# `_railway-verify.api` хоёр орхигдсон. Бүртгэгчийн самбараас бүтэн
# zone-ыг харж байж жагсаалтыг бүрдүүлнэ — DNS-ээс «бүх бичлэгийг
# өг» гэж асуух арга байдаггүй.

set -uo pipefail
NS="${1:-1.1.1.1}"
[[ "$NS" =~ ^[0-9.]+$ ]] || NS="@$NS"
[[ "$NS" == @* ]] || NS="@$NS"

DKIM='p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDF7JDVUXHhtlwLH6Avh/tNlMWerqAIFqmCM5rhwG1DIbDBoT522bbmaEJ3bVNJDIJjkihu306zCS8I4FdvUqEGh31YjyokcSP//ifKa4UsnrDoPeuP0hns8a31+BSfizA82CqPHPc4NCPyS7fouIAFYbySKPFGGukV8COvhF3PiwIDAQAB'

bad=0
check() {           # нэр төрөл хүлээгдэж-буй-утга
  printf '  %-34s %-6s ' "$1" "$2"
  got=$(dig +short +timeout=8 "$NS" "$1" "$2" 2>/dev/null | tr -d '"' | tr '\n' ' ' | sed 's/ *$//')
  if [[ "$got" == *"$3"* ]]; then
    echo "✓"
  else
    bad=$((bad+1))
    echo "✗  хүлээсэн: $3"
    echo "     ирсэн:  ${got:-—}"
  fi
}

echo "── $NS-аас асууж байна ──"
check winfit.mn                   A     216.198.79.1
check www.winfit.mn               CNAME cf39c966e6899a68.vercel-dns-017.com.
check admin.winfit.mn             CNAME cf39c966e6899a68.vercel-dns-017.com.
check api.winfit.mn               CNAME 70d96in9.up.railway.app.
check send.winfit.mn              CNAME send.forge.rmta.net.
# Resend-ийн буцаах замын бичлэг. Тусад нь — `send`-тэй хамт ирдэггүй.
check rsend.winfit.mn             CNAME rsend-apne1.forge.rmta.net.
check _dmarc.winfit.mn            TXT   'v=DMARC1; p=none;'
# Railway домэйны эзэмшил баталгаа. Алга болвол api.winfit.mn цуцлагдана.
check _railway-verify.api.winfit.mn TXT 'railway-verify=00e1e4256ac906b624bf21e557a0e5d644f82fa97646262e953ced41be9d1f48'
check resend._domainkey.winfit.mn TXT   "$DKIM"

echo
if [ "$bad" -eq 0 ]; then
  echo "✓ 9/9 ЗӨВ"
else
  echo "✗ $bad бичлэг буруу — засахгүйгээр nameserver БҮҮ СОЛИ"
  exit 1
fi

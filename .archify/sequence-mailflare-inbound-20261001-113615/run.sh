#!/bin/sh
cd /Users/pvhieuit/open-repo/mailflare && node .archify/sequence-mailflare-inbound-20261001-113615/build.mjs /private/tmp/claude-501/-Users-pvhieuit-open-repo-mailflare/15a04ea7-58d6-4f65-942a-e2d46600eeb5/scratchpad/vi.json .archify/sequence-mailflare-inbound-20261001-113615/candidate.json && node .claude/skills/archify/bin/archify.mjs finalize sequence .archify/sequence-mailflare-inbound-20261001-113615/candidate.json .archify/sequence-mailflare-inbound-20261001-113615/mailflare-inbound.html --repo-root . --quality showcase --json "$@" > /private/tmp/claude-501/-Users-pvhieuit-open-repo-mailflare/15a04ea7-58d6-4f65-942a-e2d46600eeb5/scratchpad/seq-fin.json 2>&1; echo exit $?
python3 -c "
import json
d=json.load(open('/private/tmp/claude-501/-Users-pvhieuit-open-repo-mailflare/15a04ea7-58d6-4f65-942a-e2d46600eeb5/scratchpad/seq-fin.json'))
print(d['status'], d['gates'])
for x in d.get('diagnostics',[])[:12]: print('-', x['code'], x['message'][:400], json.dumps(x.get('evidence'),ensure_ascii=False)[:500] if x.get('evidence') else '')
print(d.get('diagnosticSummary')); print({k:d.get(k) for k in ('visualReview','layoutReviewRecommendation','visualReviewRecommendation','update')})
"

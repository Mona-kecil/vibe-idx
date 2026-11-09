# Live verification

Verified on 9 November 2026 with Node 24 and Wrangler 4.158.0 local workerd. The final scheduled run started at 08:58:44 UTC. All bucket reads and writes used a local R2 instance in `/tmp`. There was no deployment or production R2 write. The BPS key came from a private file at runtime and was absent from outputs.

## Source counts

All six prototype RSS URLs returned HTTP 200 in local workerd and produced these counts:

| Source ID  | Headlines |
| ---------- | --------: |
| cnbc-id    |        85 |
| antara     |        20 |
| bloomberg  |        20 |
| cnbc-world |        30 |
| cnbc-top   |        30 |
| wsj        |        20 |

The published local file contained 205 feed records and 28 tagged headlines after the final precision change. Counts retain each feed independently. A code with intervening descriptive words no longer qualifies on stock context alone.

| Calendar source | Published events | November 2026 events |
| --------------- | ---------------: | -------------------: |
| ForexFactory    |                8 |                    8 |
| BPS             |              123 |                   13 |
| Bank Indonesia  |               12 |                    1 |

BPS action discovery, the action POST, and both current-month WebAPI pages succeeded. BI's November meeting is November 17 to 18. The calendar uses November 18 as the decision day and marks the release time unknown.

BPS initially challenged requests without browser Accept and language headers. The final request helper includes those headers. A separate Node recheck immediately after the successful Worker run encountered a ForexFactory request failure. The production collector refreshes that source hourly. Failure retention was tested separately, including complete bootstrap failure, one failed source, recovery, and ticker lookup failure.

## Fifteen tag judgments

These are paraphrased descriptions of the live sample. The repository contains no publisher headlines or summaries from the sample. Each link identifies the original item. The judgment concerns the assigned ticker, not completeness of all possible tags.

| Item                                                                                                                                                                    | Tag  | Judgment | Evidence                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------- | ---------------------------------------------------------------------------------------- |
| [Garuda financial results](https://www.cnbcindonesia.com/market/20261109150303-17-783602/pendapatan-naik-132-rugi-garuda--giaa--jadi-susut-3)                           | GIAA | Correct  | Garuda Indonesia appears in the RSS summary.                                             |
| [Venteny management changes](https://www.cnbcindonesia.com/market/20261109123754-17-783514/dirut-hingga-komisaris-utama-vtny-kompak-mundur-ada-apa)                     | VTNY | Correct  | Venteny Fortuna International appears in the RSS summary.                                |
| [Garuda finance appointment](https://www.cnbcindonesia.com/market/20261109144358-17-783588/profil-sophia-wattimena-eks-ojk-kini-jabat-dirkeu-garuda--giaa-)             | GIAA | Correct  | Garuda Indonesia appears in the RSS summary.                                             |
| [Bayan share sale](https://www.cnbcindonesia.com/market/20261109130346-19-783530/low-tuck-kwong-buka-suara-soal-penjualan-saham-byan-ke-haji-isam)                      | BYAN | Correct  | Bayan Resources appears in the RSS summary. The headline also identifies shares in BYAN. |
| [Mandiri earnings](https://www.cnbcindonesia.com/market/20261109134348-17-783560/laba-bank-mandiri--bmri--oktober-2026-tembus-rp4652-triliun)                           | BMRI | Correct  | Bank Mandiri appears in the headline and summary.                                        |
| [BRI subsidiary restructuring](https://www.cnbcindonesia.com/market/20261109115657-17-783493/dukung-streamlining-bumn-bri-buka-opsi-aksi-korporasi-anak-usaha)          | BBRI | Correct  | Bank Rakyat Indonesia appears in the RSS summary.                                        |
| [Garuda board appointments](https://www.cnbcindonesia.com/market/20261109141240-17-783577/garuda--giaa--angkat-hadiyan-jadi-wadirut-dirkeu-eks-pejabat-ojk)             | GIAA | Correct  | Garuda Indonesia appears in the RSS summary.                                             |
| [State-owned index movers](https://www.cnbcindonesia.com/market/20261109132822-17-783555/ihsg-sukses-menguat-di-sesi-i-6-saham-bumn-ini-jadi-penopang-utama)            | BMRI | Correct  | Bank Mandiri appears among the companies in the RSS summary.                             |
| [BRI repurchase plan](https://www.cnbcindonesia.com/market/20261109105420-17-783463/siapkan-buyback-saham-rp1-triliun-bos-bri-ungkap-alasannya)                         | BBRI | Correct  | Bank Rakyat Indonesia appears in the RSS summary.                                        |
| [BRI business outlook](https://www.cnbcindonesia.com/market/20261109111251-17-783470/bos-bri--bbri--ungkap-proyeksi-kinerja-di-2026)                                    | BBRI | Correct  | Bank Rakyat Indonesia appears in the RSS summary.                                        |
| [Avia distribution](https://www.cnbcindonesia.com/market/20261109100708-17-783437/emiten-cat-konglo-surabaya--avia--bagi-dividen-rp700-m-ini-jadwalnya)                 | AVIA | Correct  | Avia Avian appears in the RSS summary.                                                   |
| [AKR acquisition](https://www.cnbcindonesia.com/market/20261109094257-17-783433/bp-cabut-dari-bisnis-spbu-di-ri-sahamnya-dicaplok-akr--akra-)                           | AKRA | Correct  | AKR Corporindo appears in the RSS summary.                                               |
| [Garuda finance resignation](https://www.cnbcindonesia.com/market/20261109101324-17-783438/direktur-keuangan-garuda--giaa--balagopal-kunduvara-mundur)                  | GIAA | Correct  | Garuda Indonesia appears in the RSS summary.                                             |
| [Rukun Raharja subsidiary acquisition](https://www.cnbcindonesia.com/market/20261109085118-17-783413/entitas-rukun-raharja--raja--caplok-90-saham-perusahaan-kapal-lng) | RAJA | Correct  | Rukun Raharja appears in the headline and summary.                                       |
| [Telkom share disposal](https://www.cnbcindonesia.com/market/20261109084738-17-783406/diam-diam-anggota-dpr-as-lego-saham-telkom-saat-heboh-msci)                       | TLKM | Correct  | Telkom Indonesia appears in the RSS summary.                                             |

## Reproduce

Run `pnpm --filter @vibe-idx/feeds verify:live /path/to/private/bps-key-file /tmp/feeds-verification`. This writes JSON and a diagnostic report to scratch storage. RSS and calendar contents change over time, so counts can change. See the README for local workerd commands and required secret names.

The feeds package has 37 offline tests. They cover RSS summaries, company-name boundaries, ambiguous codes, ForexFactory impact and timezone conversion, BPS endpoint rediscovery and pagination, all twelve BI dates, source retention and recovery, and credential-safe reporting. The repository check, web build, and existing web and pipeline suites also passed. The existing suites used `--maxWorkers=2` after their default concurrent runs hit five-second timeouts.

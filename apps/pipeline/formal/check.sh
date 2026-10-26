#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
formal_dir=$PWD
cache="$formal_dir/.cache"
mkdir -p "$cache"
jar="$cache/tla2tools.jar"
url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
sha=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88

checksum() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

if [[ ! -f "$jar" ]]; then
  curl -fL "$url" -o "$jar.download"
  mv "$jar.download" "$jar"
fi
if [[ $(checksum "$jar") != "$sha" ]]; then
  echo 'TLA+ jar checksum failed; remove .cache/tla2tools.jar and retry.' >&2
  exit 1
fi

java_bin=
if command -v java >/dev/null && java -version >/dev/null 2>&1; then
  java_bin=$(command -v java)
elif command -v brew >/dev/null; then
  java_bin="$(brew --prefix openjdk@21)/bin/java"
fi
if [[ -z "$java_bin" || ! -x "$java_bin" ]]; then
  echo 'Install Java 11+: brew install openjdk@21 (or install Temurin 21).' >&2
  exit 1
fi
version=$("$java_bin" -version 2>&1 | head -n 1 | sed -E 's/.*version "([0-9]+).*/\1/')
if [[ ! "$version" =~ ^[0-9]+$ ]] || (( version < 11 )); then
  echo 'Java 11+ is required; install Temurin 21 or brew install openjdk@21.' >&2
  exit 1
fi
printf 'Java: %s\nTLA+ tools: v1.7.4, SHA-256 %s\n' "$java_bin" "$sha"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp BrokerCollector.tla BrokerCollector.cfg BrokerCollectorUnqueued.cfg "$work/"

run_tlc() {
  local cfg=$1 log=$2
  # -deadlock disables deadlock errors: exited/crashed/bounded terminal states
  # are expected. Safety invariants still run on every reachable state.
  (cd "$work" && "$java_bin" -Xmx2g -XX:+UseParallelGC -cp "$jar" tlc2.TLC \
    -workers auto -deadlock -config "$cfg" BrokerCollector.tla) >"$log" 2>&1
}

mode=${1:-queued}
case "$mode" in
  queued|unqueued)
    cfg=BrokerCollector.cfg
    [[ "$mode" == queued ]] || cfg=BrokerCollectorUnqueued.cfg
    log="$cache/$mode.log"
    if run_tlc "$cfg" "$log"; then
      cat "$log"
      if ! grep -q 'Model checking completed. No error has been found.' "$log"; then
        echo "$cfg failed: TLC did not complete." >&2
        exit 1
      fi
      echo "$cfg passed."
    else
      cat "$log"
      if grep -q 'is violated' "$log" && command -v node >/dev/null; then
        node trace.mjs "$log" "$cache/$mode.html"
      fi
      if [[ "$mode" == unqueued ]] && grep -q 'Invariant LedgerIntegrity is violated' "$log"; then
        echo "$cfg failed: known finding, overlapping runs can publish a stale or torn restore."
      else
        echo "$cfg failed."
      fi
      exit 1
    fi
    ;;
  mutants)
    for mutant in M1 M2 M3 M4; do
      cp "$formal_dir/BrokerCollector.tla" "$work/BrokerCollector.tla"
      cfg=BrokerCollector.cfg
      case "$mutant" in
        M1) from='CoverageFirst == FALSE'; to='CoverageFirst == TRUE'; invariant=LedgerIntegrity ;;
        M2) from='DeleteOnFailure == FALSE'; to='DeleteOnFailure == TRUE'; invariant=TokenRecoverable ;;
        M3) from='CommitBeforeRaw == FALSE'; to='CommitBeforeRaw == TRUE'; invariant=LedgerIntegrity ;;
        M4) from='MarkerConditional == TRUE'; to='MarkerConditional == FALSE'; invariant=MutualExclusion
            cfg=BrokerCollectorUnqueued.cfg ;;
      esac
      # Fixed literal substitutions; each switch models one ordering/guard edit.
      perl -pi -e "s/\Q$from\E/$to/" "$work/BrokerCollector.tla"
      log="$cache/$mutant.log"
      if run_tlc "$cfg" "$log"; then
        cat "$log"
        echo "$mutant escaped: expected $invariant." >&2
        exit 1
      fi
      if ! grep -q "Invariant $invariant is violated" "$log"; then
        cat "$log"
        echo "$mutant failed for an unexpected reason; expected $invariant." >&2
        exit 1
      fi
      echo "$mutant caught: $invariant ($cfg)."
      grep -E 'states generated|depth of the complete|Finished in' "$log"
    done
    ;;
  *) echo 'Usage: check.sh [unqueued|mutants]' >&2; exit 1 ;;
esac

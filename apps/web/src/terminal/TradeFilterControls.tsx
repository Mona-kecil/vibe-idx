import { useCallback, useEffect, useState } from 'react';
import { clock } from '../ticks.js';
import { useTerminal } from './state.js';
import {
  activeCount,
  boards,
  emptyFilter,
  investors,
  joins,
  parseClock,
  setBroker,
} from './trade-filter.js';
import { Segments } from './ui.js';
import './trade-filter.css';

const boardNames = { ALL: 'ALL', RG: 'REGULAR', NG: 'NEGOTIATION', TN: 'CASH' } as const;

/** One pane's filter and whether its controls are open. Prices belong to a ticker, so a new ticker clears the range. */
export function useTradeFilter() {
  const { ticker } = useTerminal();
  const [filter, setFilter] = useState(emptyFilter);
  const [open, setOpen] = useState(false);
  const [resets, setResets] = useState(0);
  useEffect(() => {
    setFilter((previous) =>
      previous.price.min === null && previous.price.max === null
        ? previous
        : { ...previous, price: emptyFilter.price },
    );
  }, [ticker]);
  const reset = useCallback((keepAction: boolean) => {
    setFilter((previous) => ({ ...emptyFilter, action: keepAction ? previous.action : 'ALL' }));
    setResets((count) => count + 1);
  }, []);
  return { filter, setFilter, open, setOpen, resets, reset };
}
export type TradeFilterState = ReturnType<typeof useTradeFilter>;

export function FilterToggle({ state }: { state: TradeFilterState }) {
  const count = activeCount(state.filter);
  return (
    <button
      className="tick-filter-toggle"
      aria-expanded={state.open}
      onClick={() => state.setOpen(!state.open)}
    >
      FILTER{count > 0 && ` ${count}`}
    </button>
  );
}

function BrokerInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="tick-filter"
      aria-label={label}
      placeholder={label.replace(' broker', '')}
      value={value}
      maxLength={4}
      onChange={(event) => onChange(event.target.value.toUpperCase().trim())}
    />
  );
}

function NumberInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      className="tick-filter"
      type="number"
      min={0}
      step="any"
      aria-label={label}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(event) => {
        const next = event.target.valueAsNumber;
        onChange(event.target.value === '' || Number.isNaN(next) ? null : next);
      }}
    />
  );
}

/** Keeps what the user typed, so a half-typed time shows as invalid instead of being rewritten. */
function ClockInput({
  label,
  placeholder,
  value,
  end = false,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  /** An end time without seconds covers its whole minute. */
  end?: boolean;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : clock(value).slice(0, 5));
  const invalid = text.trim() !== '' && parseClock(text) === null;
  return (
    <input
      className="tick-filter"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      inputMode="numeric"
      maxLength={8}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseClock(event.target.value, end));
      }}
    />
  );
}

export function FilterControls({ state }: { state: TradeFilterState }) {
  const { filter, setFilter, resets, reset } = state;
  if (!state.open) return null;
  return (
    <div className="tick-filter-controls" role="group" aria-label="Trade filter" key={resets}>
      <Segments
        label="Board"
        values={boards}
        value={filter.board}
        renderOption={(board) => boardNames[board]}
        onChange={(board) => setFilter({ ...filter, board })}
      />
      <Segments
        label="Investor"
        values={investors}
        value={filter.investor}
        onChange={(investor) => setFilter({ ...filter, investor })}
      />
      <div className="tick-filter-row">
        <NumberInput
          label="Lowest price"
          placeholder="Low"
          value={filter.price.min}
          onChange={(min) => setFilter({ ...filter, price: { ...filter.price, min } })}
        />
        <NumberInput
          label="Highest price"
          placeholder="High"
          value={filter.price.max}
          onChange={(max) => setFilter({ ...filter, price: { ...filter.price, max } })}
        />
        <ClockInput
          label="From time"
          placeholder="From"
          value={filter.time.from}
          onChange={(from) => setFilter({ ...filter, time: { ...filter.time, from } })}
        />
        <ClockInput
          label="To time"
          placeholder="To"
          value={filter.time.to}
          end
          onChange={(to) => setFilter({ ...filter, time: { ...filter.time, to } })}
        />
      </div>
      <div className="tick-filter-row">
        <BrokerInput
          label="Buyer broker"
          value={filter.brokers.buyer}
          onChange={(code) =>
            setFilter({ ...filter, brokers: setBroker(filter.brokers, 'buyer', code) })
          }
        />
        <Segments
          label="Broker join"
          values={joins}
          value={filter.brokers.join}
          onChange={(join) => setFilter({ ...filter, brokers: { ...filter.brokers, join } })}
        />
        <BrokerInput
          label="Seller broker"
          value={filter.brokers.seller}
          onChange={(code) =>
            setFilter({ ...filter, brokers: setBroker(filter.brokers, 'seller', code) })
          }
        />
        <button
          className="tick-filter-reset"
          disabled={activeCount(filter) === 0}
          onClick={() => reset(true)}
        >
          RESET
        </button>
      </div>
    </div>
  );
}

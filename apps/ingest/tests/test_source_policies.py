from __future__ import annotations

import json

from idx_ingest.sources import SOURCES, source_policy


def test_every_cli_source_has_serializable_policy_metadata() -> None:
    assert set(SOURCES) == {
        "market-summary",
        "ksei-5pct",
        "insider",
        "ksei-1pct",
        "laporan-efek",
    }

    for name in SOURCES:
        metadata = source_policy(name).as_dict()
        json.dumps(metadata)
        assert metadata["name"] == name
        assert metadata["update_frequency"] in {"daily", "monthly"}
        assert metadata["source_route"]
        assert metadata["latest_strategy"]
        assert metadata["historical_date_basis"]
        assert metadata["selection_rule"]


def test_monthly_sources_document_query_and_history_rules() -> None:
    ksei_1pct = source_policy("ksei-1pct").as_dict()
    laporan_efek = source_policy("laporan-efek").as_dict()

    assert ksei_1pct["keyword"] == "1%"
    assert ksei_1pct["title_filter"] == "Pemegang Saham di atas 1% (KSEI)"
    assert ksei_1pct["historical_date_basis"] == "idx_disclosure_publish_month"
    assert ksei_1pct["selection_rule"] == "first_matching_title"

    assert laporan_efek["keyword"] == "laporan efek"
    assert laporan_efek["title_filter"] is None
    assert laporan_efek["historical_date_basis"] == "idx_disclosure_publish_month"
    assert laporan_efek["selection_rule"] == "top_search_result"

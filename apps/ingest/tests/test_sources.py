from __future__ import annotations

from idx_ingest.ingest import (
    INSIDER_TITLE,
    announcement_matches_title,
    choose_lamp1,
    is_insider_announcement,
    is_insider_attachment,
    ownership_list_url,
)


def test_1pct_filter_skips_unrelated_keyword_hits() -> None:
    unrelated = {"pengumuman": {"JudulPengumuman": "Keterbukaan Informasi terkait 1 Juli"}}
    target = {"pengumuman": {"JudulPengumuman": "Pemegang Saham di atas 1% (KSEI)"}}
    assert not announcement_matches_title(unrelated, "Pemegang Saham di atas 1% (KSEI)")
    assert announcement_matches_title(target, "Pemegang Saham di atas 1% (KSEI)")


def test_5pct_uses_ownership_list_route() -> None:
    assert (
        ownership_list_url(2026)
        == "https://www.idx.co.id/primary/list/id/perusahaan-tercatat/"
        "data-kepemilikan-saham/?year=2026&lang=id"
    )


def test_insider_filter_skips_material_info_keyword_hits() -> None:
    unrelated = {"pengumuman": {"JudulPengumuman": "Laporan Informasi dan Fakta Material"}}
    target = {"pengumuman": {"JudulPengumuman": INSIDER_TITLE}}
    assert not announcement_matches_title(unrelated, INSIDER_TITLE)
    assert announcement_matches_title(target, INSIDER_TITLE)


def test_insider_filter_accepts_company_specific_ownership_report_title() -> None:
    item = {
        "pengumuman": {
            "JudulPengumuman": (
                "Laporan Kepemilikan atau Setiap Perubahan Kepemilikan Saham "
                "PT Bank KB Indonesia Tbk"
            )
        }
    }
    assert is_insider_announcement(item)


def test_choose_lamp1_attachment() -> None:
    item = {
        "attachments": [
            {"OriginalFilename": "main.pdf", "IsAttachment": False},
            {"OriginalFilename": "report_lamp1.pdf", "IsAttachment": True},
        ]
    }
    attachment = choose_lamp1(item)
    assert attachment is not None
    assert attachment["OriginalFilename"] == "report_lamp1.pdf"


def test_insider_attachment_skips_material_info_pdf() -> None:
    assert is_insider_attachment(
        {
            "OriginalFilename": "LK-08062026-4607-00.pdf",
            "FullSavePath": "https://www.idx.co.id/StaticData/From_KSEI/LK-08062026-4607-00.pdf",
        }
    )
    assert not is_insider_attachment(
        {
            "OriginalFilename": "20260611_SPMA_Laporan Informasi dan Fakta Material_32100514.pdf",
            "FullSavePath": "https://www.idx.co.id/StaticData/From_EREP/spma.pdf",
        }
    )


def test_insider_attachment_accepts_lampiran_company_report_pdf() -> None:
    assert is_insider_attachment(
        {
            "OriginalFilename": (
                "20260701_BBKP_Laporan Informasi dan Fakta Material_32106991_lamp1.pdf"
            ),
            "FullSavePath": "https://www.idx.co.id/StaticData/From_EREP/bbkp-lamp1.pdf",
            "IsAttachment": True,
        }
    )

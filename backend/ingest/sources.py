"""Registry of real archival sources.

Curated deliberately rather than globbed, because the audit found material
in Data/ that must not enter the index:

  * dr-babasaheb-ambedkar-writings-and-speeches-vol-5.pdf is a verified
    duplicate of Volume5.pdf (12/12 distinctive text probes matched). Two
    citations for one text would undermine the citation guarantee.
  * The 28 cad_*_hindi.pdf and 6 VolumeH*.pdf files use a legacy
    non-Unicode Devanagari encoding - zero Devanagari codepoints extract.
  * 'Videos - Dr. Ambekar Foundation_files/' is saved-webpage CSS and JS.
  * WhatsApp/IMG-2025 images have no established provenance.

Metadata here is the seed of the metadata register (PS req 13). Fields
left None are for the team to fill in as the licence register is compiled.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    file_path: str                      # relative to the repository root
    doc_type: str                       # Writing|Speech|Debate|Manuscript|Audio|Video
    volume: str | None = None
    date_text: str | None = None
    author: str = "B. R. Ambedkar"
    source: str = "Dr. Ambedkar Foundation, Ministry of Social Justice & Empowerment"
    publisher: str | None = "Dr. Ambedkar Foundation"
    language: str = "en"
    licence: str | None = None
    # The volume's own running head, stripped during extraction so it is
    # never mistaken for the name of a work inside the volume.
    running_head: str | None = None
    phase: int = 1
    notes: str = ""


WRITINGS_HEAD = "DR. BABASAHEB AMBEDKAR : WRITINGS AND SPEECHES"

# Phase markers above the real phases. `for_phase()` only ever selects
# sources at or below the requested phase, so these are never ingested by
# an ordinary build - they have to be asked for by id.
HELD_BACK = 90   # withheld deliberately; see the note on the source
DEFERRED = 99    # out of scope for Round 2

SOURCES: list[Source] = [
    Source(
        id="ws-vol-01",
        title="Dr. Babasaheb Ambedkar: Writings and Speeches, Volume 1",
        file_path="Data/SIH_heritage_docs/Volume1.pdf",
        doc_type="Writing",
        volume="Vol. I",
        date_text="1917-1956",
        running_head=WRITINGS_HEAD,
        licence="Government of India publication - Dr. Ambedkar Foundation",
        phase=1,
        notes="Contains Castes in India, Annihilation of Caste, Federation "
              "versus Freedom, States and Minorities, Thoughts on Linguistic States.",
    ),
    Source(
        id="ws-vol-02",
        title="Dr. Babasaheb Ambedkar: Writings and Speeches, Volume 2",
        file_path="Data/SIH_heritage_docs/Volume2.pdf",
        doc_type="Writing",
        volume="Vol. II",
        running_head=WRITINGS_HEAD,
        licence="Government of India publication - Dr. Ambedkar Foundation",
        phase=2,
    ),
    Source(
        id="ws-vol-03",
        title="Dr. Babasaheb Ambedkar: Writings and Speeches, Volume 3",
        file_path="Data/SIH_heritage_docs/Volume3.pdf",
        doc_type="Writing",
        volume="Vol. III",
        running_head=WRITINGS_HEAD,
        licence="Government of India publication - Dr. Ambedkar Foundation",
        phase=HELD_BACK,
        notes="HELD BACK ON PURPOSE for the live archivist ingestion demo "
              "(PS req 14). Keeping a real, substantial document the system has "
              "never seen makes upload -> review -> approve -> index -> query an "
              "authentic run rather than a staged one. Do not add to the Phase 2 "
              "corpus. Contents: Philosophy of Hinduism, The Triumph of "
              "Brahmanism, Krishna and His Gita, Buddha or Karl Marx.",
    ),
    Source(
        id="ws-vol-04",
        title="Dr. Babasaheb Ambedkar: Writings and Speeches, Volume 4",
        file_path="Data/SIH_heritage_docs/Volume4.pdf",
        doc_type="Writing",
        volume="Vol. IV",
        running_head=WRITINGS_HEAD,
        licence="Government of India publication - Dr. Ambedkar Foundation",
        phase=DEFERRED,
        notes="Deferred past Round 2. Its running heads are bare numbers "
              "('Riddle No. 15'), so a citation would read 'Vol. IV, Riddle No. "
              "15, p. 220' and tell a reader nothing about the subject. Every "
              "other volume yields a titled work.",
    ),
    Source(
        id="ws-vol-05",
        title="Dr. Babasaheb Ambedkar: Writings and Speeches, Volume 5",
        file_path="Data/SIH_heritage_docs/Volume5.pdf",
        doc_type="Writing",
        volume="Vol. V",
        running_head=WRITINGS_HEAD,
        licence="Government of India publication - Dr. Ambedkar Foundation",
        phase=2,
    ),
    Source(
        id="cad-1949-06-15",
        title="Constituent Assembly Debates, 15 June 1949 (Part II)",
        file_path="Data/SIH_heritage_docs/Debates & Constituent Assembly Speeches/"
                  "Constituent_Assembly_Debates_On_15_June_1949_Part_Ii.PDF",
        doc_type="Debate",
        volume="Vol. VIII",
        date_text="15 June 1949",
        author="Constituent Assembly of India",
        source="Constituent Assembly of India",
        publisher="Lok Sabha Secretariat",
        licence="Government of India - public record",
        phase=2,
        notes="The only English Constituent Assembly Debate file in the "
              "repository. Further English sessions must be obtained externally.",
    ),
]

# Explicitly excluded, with the reason. Kept in code so the exclusion is a
# recorded decision rather than an omission someone silently reverses.
EXCLUDED: dict[str, str] = {
    "Data/SIH_heritage_docs/Books, Manuscripts & Archival Papers/"
    "dr-babasaheb-ambedkar-writings-and-speeches-vol-5.pdf":
        "Duplicate of Volume5.pdf (12/12 text probes matched). Indexing both "
        "would yield two different citations for identical text.",
    "Data/SIH_heritage_docs/Debates & Constituent Assembly Speeches/volume_*/cad_*_hindi.pdf":
        "Legacy non-Unicode Devanagari encoding; zero Devanagari codepoints extract.",
    "Data/SIH_heritage_docs/Writings_and_speeches/VolumeH*.pdf":
        "Legacy non-Unicode Devanagari encoding; same problem, 70 MB.",
    "Data/SIH_heritage_docs/Photographs & Historical Gallery/"
    "Videos - Dr. Ambekar Foundation_files/":
        "Saved-webpage CSS/JS assets. No archival content.",
}


def by_id(source_id: str) -> Source | None:
    return next((s for s in SOURCES if s.id == source_id), None)


def for_phase(phase: int) -> list[Source]:
    """Sources scheduled up to and including `phase`."""
    return [s for s in SOURCES if s.phase <= phase]

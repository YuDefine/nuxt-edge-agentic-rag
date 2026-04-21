## ADDED Requirements

### Requirement: Upload Wizard Format Tier Disclosure

The admin upload wizard SHALL disclose source format tiers and keep its client-side validation aligned with server-side ingestion support. The wizard SHALL distinguish direct-text formats (`.txt`, `.md`), supported-rich formats (`.pdf`, `.docx`, `.xlsx`, `.pptx`), and deferred formats that require a conversion or transcript workflow before they can become replayable knowledge snapshots.

#### Scenario: Supported rich format is accepted by the wizard

- **WHEN** an Admin selects a `.pdf`, `.docx`, `.xlsx`, or `.pptx` source file within the size limit
- **THEN** the wizard allows the upload flow to proceed
- **AND** the UI identifies the file as a supported rich format rather than a generic text upload

#### Scenario: Legacy Office format shows conversion guidance

- **WHEN** an Admin selects a `.doc`, `.xls`, or `.ppt` source file
- **THEN** the wizard blocks the upload before presign
- **AND** the validation message explains that the file must be converted to a supported modern Office or text-based format first

#### Scenario: Media format shows transcript-pipeline guidance

- **WHEN** an Admin selects an audio or video source file
- **THEN** the wizard blocks the upload before presign
- **AND** the validation message explains that media ingestion is deferred to a future transcript pipeline

#### Scenario: Extraction failure shows a next-step message

- **WHEN** a supported rich format upload passes file validation but the server later rejects sync because no replayable text could be extracted
- **THEN** the wizard surfaces an extraction-failed message
- **AND** the message suggests a concrete next step such as converting the source to a text-friendly format or preparing a manually reviewed Markdown snapshot

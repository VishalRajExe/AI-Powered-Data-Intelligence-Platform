package ai.finalagent.dataset.export;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import ai.finalagent.dataset.domain.DatasetRows;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The three writers, checked against what a reader would actually do with the file.
 *
 * <p>CSV is asserted as bytes, not as a parsed model, because its whole job is to survive a spreadsheet
 * program: the BOM, the CRLF and the doubled quotes are the parts that fail silently when they are
 * wrong. XLSX is read back through POI rather than inspected as it is written, so "the number stayed a
 * number" is a statement about the file.
 *
 * <p>The formula guard appears in two of the three formats and is asserted in both. A dataset value is
 * text somebody else put on a web page, so {@code =cmd|…} reaching a cell is not a hypothetical.
 */
class ExportWriterTest {

    private static final DatasetRows.Column NAME = new DatasetRows.Column("c1", "d1", "name",
            "Company name", "STRING", true, 0, "PLAN", null, 3);
    private static final DatasetRows.Column SALARY = new DatasetRows.Column("c2", "d1", "salary",
            "Salary", "NUMBER", false, 1, "PIPELINE", null, 2);
    private static final DatasetRows.Column NOTES = new DatasetRows.Column("c3", "d1", "notes",
            "Notes", "STRING", false, 2, "DATA", null, 1);

    private static final List<DatasetRows.Column> COLUMNS = List.of(NAME, SALARY, NOTES);
    private static final Map<String, Object> META = Map.of("exportId", "e-1", "datasetId", "d-1",
            "entityType", "startup", "qualityScore", 0.82);

    private static ExportRow row(int index, Map<String, Object> values) {
        return new ExportRow(index, values, values, true, true, "SOURCE_CITED", 0.9, null,
                List.of(Map.of("url", "https://a.test/1", "verifiedByTool", true)), List.of());
    }

    /**
     * The written bytes decoded without their BOM.
     *
     * <p>Dropping the three bytes rather than three characters: {@code EF BB BF} decodes to a single
     * {@code U+FEFF}, so slicing the decoded string would eat the header's first letter and the test
     * would fail for the wrong reason.
     */
    private static String withoutBom(ByteArrayOutputStream buffer) {
        byte[] raw = buffer.toByteArray();
        return new String(raw, 3, raw.length - 3, StandardCharsets.UTF_8);
    }

    private static List<String> lines(ByteArrayOutputStream buffer) {
        return List.of(withoutBom(buffer).split("\r\n"));
    }

    @Test
    void csvStartsWithABomUsesCrlfAndDoublesTheQuotesItHasToEscape() throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        ExportWriter writer = new ExportWriter.Csv(buffer);
        writer.begin(COLUMNS, META);
        writer.write(row(0, Map.of("name", "Northwind, Inc.", "salary", 60000,
                "notes", "said \"funded\"")));
        writer.write(row(1, Map.of("name", "Üntra", "salary", 72000)));
        long bytes = writer.finish();

        byte[] raw = buffer.toByteArray();
        assertThat(raw[0]).isEqualTo((byte) 0xEF);
        assertThat(raw[1]).isEqualTo((byte) 0xBB);
        assertThat(raw[2]).isEqualTo((byte) 0xBF);
        assertThat(bytes).isEqualTo(raw.length);

        List<String> lines = lines(buffer);
        assertThat(lines).hasSize(3);
        assertThat(lines.get(0)).isEqualTo("name,salary,notes");
        // The comma and the quotes both force quoting; the quotes inside double.
        assertThat(lines.get(1)).isEqualTo("\"Northwind, Inc.\",60000,\"said \"\"funded\"\"\"");
        // Without the BOM above, this is the character Excel would turn into garbage.
        assertThat(lines.get(2)).isEqualTo("Üntra,72000,");
    }

    @Test
    void csvRefusesToHandOverACellThatAFormulaBarWouldExecute() throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        ExportWriter writer = new ExportWriter.Csv(buffer);
        writer.begin(List.of(NAME), META);
        writer.write(row(0, Map.of("name", "=HYPERLINK(\"https://evil.test\",\"click\")")));
        writer.write(row(1, Map.of("name", "@SUM(A1)")));
        writer.write(row(2, Map.of("name", "+358400000000")));
        writer.write(row(3, Map.of("name", "12 % off")));
        writer.finish();

        List<String> lines = lines(buffer);
        // The apostrophe sits outside the quoting, where Excel reads it as "this cell is text"; the
        // doubled quotes inside are RFC 4180 doing its job. Inside the quoting it would be content,
        // visible in the cell and achieving nothing.
        assertThat(lines.get(1)).isEqualTo("'\"=HYPERLINK(\"\"https://evil.test\"\",\"\"click\"\")\"");
        assertThat(lines.get(2)).isEqualTo("'@SUM(A1)");
        // A leading minus or plus is a phone number as often as a formula, which is why the guard is
        // on the character rather than on a guess about intent — and why it never removes the value.
        assertThat(lines.get(3)).isEqualTo("'+358400000000");
        assertThat(lines.get(4)).isEqualTo("12 % off");
    }

    @Test
    void jsonCarriesTheContractAndTheProvenanceThatMadeTheRow() throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        ExportWriter writer = new ExportWriter.JsonFile(buffer);
        writer.begin(COLUMNS, META);
        writer.write(row(0, Map.of("name", "Northwind", "salary", 60000)));
        long bytes = writer.finish();
        assertThat(bytes).isEqualTo((long) buffer.size());

        Map<String, Object> doc = new ObjectMapper().readValue(buffer.toByteArray(), Map.class);
        assertThat(doc).containsKeys("dataset", "columns", "rows");
        @SuppressWarnings("unchecked")
        Map<String, Object> dataset = (Map<String, Object>) doc.get("dataset");
        assertThat(dataset).containsEntry("exportId", "e-1").containsEntry("entityType", "startup");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> columns = (List<Map<String, Object>>) doc.get("columns");
        assertThat(columns).extracting(column -> column.get("key"))
                .containsExactly("name", "salary", "notes");
        // Origin travels with the column: an export read months later still says which fields were
        // asked for and which the web happened to contain.
        assertThat(columns.get(2).get("origin")).isEqualTo("DATA");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) doc.get("rows");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("valid", true)
                .containsEntry("verificationStatus", "SOURCE_CITED");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> sources = (List<Map<String, Object>>) rows.get(0).get("sources");
        assertThat(sources).hasSize(1);
        assertThat(sources.get(0)).containsEntry("url", "https://a.test/1")
                .containsEntry("verifiedByTool", true);
    }

    @Test
    void xlsxKeepsNumbersNumericAndReadsBackThroughTheSameLibraryAUserWould() throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        ExportWriter writer = new ExportWriter.Xlsx(buffer);
        writer.begin(COLUMNS, META);
        writer.write(row(0, Map.of("name", "Northwind", "salary", 60000, "notes", "=1+1")));
        writer.write(row(1, Map.of("name", "Üntra", "salary", 72000.5)));
        long bytes = writer.finish();
        assertThat(bytes).isEqualTo((long) buffer.size());
        assertThat(buffer.size()).isGreaterThan(0);

        try (XSSFWorkbook read = new XSSFWorkbook(new ByteArrayInputStream(buffer.toByteArray()))) {
            Sheet sheet = read.getSheet("data");
            assertThat(sheet).isNotNull();
            Row header = sheet.getRow(0);
            // The label, not the field key: this file is opened by a person.
            assertThat(header.getCell(0).getStringCellValue()).isEqualTo("Company name");
            assertThat(header.getCell(1).getStringCellValue()).isEqualTo("Salary");

            Row first = sheet.getRow(1);
            assertThat(first.getCell(0).getStringCellValue()).isEqualTo("Northwind");
            assertThat(first.getCell(1).getCellType()).isEqualTo(CellType.NUMERIC);
            assertThat(first.getCell(1).getNumericCellValue()).isEqualTo(60000.0);
            assertThat(first.getCell(2).getStringCellValue()).isEqualTo("'=1+1");

            Row second = sheet.getRow(2);
            assertThat(second.getCell(1).getNumericCellValue()).isEqualTo(72000.5);
            assertThat(second.getCell(2).getCellType()).isEqualTo(CellType.BLANK);
            assertThat(read.getNumberOfSheets()).isEqualTo(1);
        }
    }

    @Test
    void anEmptyDatasetStillProducesAFileThatOpensAndSaysSo() throws Exception {
        ByteArrayOutputStream csv = new ByteArrayOutputStream();
        ExportWriter csvWriter = new ExportWriter.Csv(csv);
        csvWriter.begin(COLUMNS, META);
        long csvBytes = csvWriter.finish();
        assertThat(csvBytes).isEqualTo((long) "name,salary,notes\r\n".length() + 3);

        ByteArrayOutputStream json = new ByteArrayOutputStream();
        ExportWriter jsonWriter = new ExportWriter.JsonFile(json);
        jsonWriter.begin(COLUMNS, META);
        jsonWriter.finish();
        Map<String, Object> doc = new ObjectMapper().readValue(json.toByteArray(), Map.class);
        assertThat((List<?>) doc.get("rows")).isEmpty();
        // Zero rows is a real answer and not an error: the header and the contract are still there.
        assertThat((List<?>) doc.get("columns")).hasSize(3);
    }
}

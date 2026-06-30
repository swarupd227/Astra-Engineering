import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

interface CellDifference {
  row: number;
  column: string;
  sourceValue: string;
  targetValue: string;
  difference: string;
  percentDiff?: number;
  status: 'exact' | 'tolerance' | 'mismatch';
}

interface ValidationResult {
  status: 'pass' | 'fail' | 'warning';
  matchPercentage: number;
  summary: {
    totalCells: number;
    matchedCells: number;
    toleranceCells: number;
    mismatchedCells: number;
    sourceRowCount: number;
    targetRowCount: number;
    sourceColumnCount: number;
    targetColumnCount: number;
    criticalIssues: number;
    warnings: number;
  };
  differences: CellDifference[];
  aiAnalysis?: string;
}

interface ValidationReportPDFProps {
  sourceFileName: string;
  targetFileName: string;
  validationResult: ValidationResult;
  generatedAt: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2px solid #0891b2',
    paddingBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0891b2',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 10,
  },
  timestamp: {
    fontSize: 9,
    color: '#94a3b8',
  },
  section: {
    marginBottom: 20,
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  sectionHeader: {
    backgroundColor: '#f1f5f9',
    padding: 10,
    borderBottom: '1px solid #e2e8f0',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#334155',
  },
  sectionContent: {
    padding: 15,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  summaryItem: {
    width: '50%',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 9,
    color: '#64748b',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  statusPass: {
    backgroundColor: '#dcfce7',
  },
  statusFail: {
    backgroundColor: '#fee2e2',
  },
  statusWarning: {
    backgroundColor: '#fef3c7',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  statusTextPass: {
    color: '#166534',
  },
  statusTextFail: {
    color: '#991b1b',
  },
  statusTextWarning: {
    color: '#92400e',
  },
  fileInfo: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  fileLabel: {
    fontSize: 10,
    color: '#64748b',
    width: 80,
  },
  fileName: {
    fontSize: 10,
    color: '#1e293b',
    fontWeight: 'bold',
  },
  matchPercentage: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#0891b2',
    textAlign: 'center',
    marginVertical: 10,
  },
  matchLabel: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'center',
  },
  table: {
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1px solid #f1f5f9',
    paddingVertical: 6,
    paddingHorizontal: 5,
  },
  tableRowMismatch: {
    backgroundColor: '#fef2f2',
  },
  tableRowTolerance: {
    backgroundColor: '#fffbeb',
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#475569',
    textTransform: 'uppercase',
  },
  tableCell: {
    fontSize: 9,
    color: '#334155',
  },
  colRow: { width: '8%' },
  colColumn: { width: '15%' },
  colSource: { width: '28%' },
  colTarget: { width: '28%' },
  colStatus: { width: '12%' },
  colDiff: { width: '9%' },
  mismatchText: {
    color: '#dc2626',
  },
  toleranceText: {
    color: '#d97706',
  },
  aiAnalysisText: {
    fontSize: 10,
    color: '#334155',
    lineHeight: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: '1px solid #e2e8f0',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#94a3b8',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
    paddingBottom: 15,
    borderBottom: '1px solid #e2e8f0',
  },
  statBox: {
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    width: '23%',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  statLabel: {
    fontSize: 8,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
  },
});

export function ValidationReportPDF({ 
  sourceFileName, 
  targetFileName, 
  validationResult,
  generatedAt 
}: ValidationReportPDFProps) {
  const { summary, differences, matchPercentage, status, aiAnalysis } = validationResult;
  
  const getStatusStyle = () => {
    switch (status) {
      case 'pass': return { badge: styles.statusPass, text: styles.statusTextPass };
      case 'fail': return { badge: styles.statusFail, text: styles.statusTextFail };
      default: return { badge: styles.statusWarning, text: styles.statusTextWarning };
    }
  };
  
  const statusStyle = getStatusStyle();
  
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Autonomous Testing Platform</Text>
          <Text style={styles.subtitle}>SSRS to PowerBI Migration Validation Report</Text>
          <Text style={styles.timestamp}>Generated: {generatedAt}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Files Compared</Text>
          </View>
          <View style={styles.sectionContent}>
            <View style={styles.fileInfo}>
              <Text style={styles.fileLabel}>Source File:</Text>
              <Text style={styles.fileName}>{sourceFileName}</Text>
            </View>
            <View style={styles.fileInfo}>
              <Text style={styles.fileLabel}>Target File:</Text>
              <Text style={styles.fileName}>{targetFileName}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Validation Summary</Text>
          </View>
          <View style={styles.sectionContent}>
            <Text style={styles.matchLabel}>Match Rate</Text>
            <Text style={styles.matchPercentage}>{matchPercentage}%</Text>
            
            <View style={[styles.statusBadge, statusStyle.badge]}>
              <Text style={[styles.statusText, statusStyle.text]}>
                {status.toUpperCase()}
              </Text>
            </View>

            <View style={[styles.statsRow, { marginTop: 15 }]}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{summary.totalCells.toLocaleString()}</Text>
                <Text style={styles.statLabel}>Total Cells</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: '#16a34a' }]}>{summary.matchedCells.toLocaleString()}</Text>
                <Text style={styles.statLabel}>Matched</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: '#d97706' }]}>{summary.toleranceCells}</Text>
                <Text style={styles.statLabel}>Within Tolerance</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: '#dc2626' }]}>{summary.mismatchedCells}</Text>
                <Text style={styles.statLabel}>Mismatched</Text>
              </View>
            </View>

            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Source Rows</Text>
                <Text style={styles.summaryValue}>{summary.sourceRowCount}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Target Rows</Text>
                <Text style={styles.summaryValue}>{summary.targetRowCount}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Source Columns</Text>
                <Text style={styles.summaryValue}>{summary.sourceColumnCount}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Target Columns</Text>
                <Text style={styles.summaryValue}>{summary.targetColumnCount}</Text>
              </View>
            </View>
          </View>
        </View>

        {differences.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Differences Detail ({differences.length} found)</Text>
            </View>
            <View style={styles.sectionContent}>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.colRow]}>Row</Text>
                  <Text style={[styles.tableHeaderCell, styles.colColumn]}>Column</Text>
                  <Text style={[styles.tableHeaderCell, styles.colSource]}>Source Value</Text>
                  <Text style={[styles.tableHeaderCell, styles.colTarget]}>Target Value</Text>
                  <Text style={[styles.tableHeaderCell, styles.colStatus]}>Status</Text>
                  <Text style={[styles.tableHeaderCell, styles.colDiff]}>Diff</Text>
                </View>
                {differences.slice(0, 20).map((diff, index) => (
                  <View 
                    key={index} 
                    style={[
                      styles.tableRow,
                      diff.status === 'mismatch' ? styles.tableRowMismatch : styles.tableRowTolerance
                    ]}
                  >
                    <Text style={[styles.tableCell, styles.colRow]}>{diff.row}</Text>
                    <Text style={[styles.tableCell, styles.colColumn]}>{diff.column}</Text>
                    <Text style={[styles.tableCell, styles.colSource]}>{diff.sourceValue || '(empty)'}</Text>
                    <Text style={[styles.tableCell, styles.colTarget]}>{diff.targetValue || '(empty)'}</Text>
                    <Text style={[
                      styles.tableCell, 
                      styles.colStatus,
                      diff.status === 'mismatch' ? styles.mismatchText : styles.toleranceText
                    ]}>
                      {diff.status}
                    </Text>
                    <Text style={[styles.tableCell, styles.colDiff]}>
                      {diff.percentDiff ? `${diff.percentDiff.toFixed(1)}%` : '-'}
                    </Text>
                  </View>
                ))}
                {differences.length > 20 && (
                  <View style={styles.tableRow}>
                    <Text style={[styles.tableCell, { fontStyle: 'italic', color: '#64748b' }]}>
                      ... and {differences.length - 20} more differences
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {aiAnalysis && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>AI Analysis</Text>
            </View>
            <View style={styles.sectionContent}>
              <Text style={styles.aiAnalysisText}>{aiAnalysis}</Text>
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Autonomous Testing Platform</Text>
          <Text style={styles.footerText}>Confidential Report</Text>
        </View>
      </Page>
    </Document>
  );
}

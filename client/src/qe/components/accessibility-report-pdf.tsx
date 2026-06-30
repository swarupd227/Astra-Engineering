import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

interface AccessibilityReportPDFProps {
  url: string;
  overallScore: number;
  violations: any[];
  wcagCriteria: any[];
  screenReaderResult: any;
  visualTestResult: any;
  aiAnalysis: any;
  generatedAt: string;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 9, backgroundColor: '#ffffff' },
  header: { marginBottom: 20, borderBottom: '3px solid #10b981', paddingBottom: 15 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#10b981', marginBottom: 3 },
  subtitle: { fontSize: 11, color: '#64748b', marginBottom: 8 },
  meta: { fontSize: 8, color: '#94a3b8' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#1e293b', marginBottom: 8, borderBottom: '1px solid #e2e8f0', paddingBottom: 4 },
  scoreBox: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 16, padding: 12, backgroundColor: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' },
  scoreBig: { fontSize: 36, fontWeight: 'bold' },
  statRow: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  statCard: { flex: 1, padding: 8, borderRadius: 4, border: '1px solid #e2e8f0', textAlign: 'center' as any },
  statValue: { fontSize: 18, fontWeight: 'bold', marginBottom: 2 },
  statLabel: { fontSize: 7, color: '#64748b' },
  violationRow: { flexDirection: 'row', marginBottom: 4, padding: 6, backgroundColor: '#fef2f2', borderRadius: 3, borderLeft: '3px solid #ef4444' },
  violationSerious: { borderLeftColor: '#f97316', backgroundColor: '#fff7ed' },
  violationModerate: { borderLeftColor: '#f59e0b', backgroundColor: '#fffbeb' },
  violationMinor: { borderLeftColor: '#3b82f6', backgroundColor: '#eff6ff' },
  badge: { fontSize: 7, padding: '2 6', borderRadius: 3, color: '#ffffff', marginRight: 6 },
  badgeCritical: { backgroundColor: '#ef4444' },
  badgeSerious: { backgroundColor: '#f97316' },
  badgeModerate: { backgroundColor: '#f59e0b' },
  badgeMinor: { backgroundColor: '#3b82f6' },
  text: { fontSize: 9, color: '#334155', lineHeight: 1.4 },
  textSmall: { fontSize: 8, color: '#64748b', lineHeight: 1.3 },
  code: { fontSize: 7, fontFamily: 'Courier', backgroundColor: '#f1f5f9', padding: 4, borderRadius: 2, color: '#475569' },
  tableRow: { flexDirection: 'row', borderBottom: '1px solid #e2e8f0', paddingVertical: 3 },
  tableCell: { flex: 1, fontSize: 8, color: '#334155', paddingHorizontal: 4 },
  tableCellHeader: { flex: 1, fontSize: 8, fontWeight: 'bold', color: '#1e293b', paddingHorizontal: 4 },
  passText: { color: '#10b981' },
  failText: { color: '#ef4444' },
  warnText: { color: '#f59e0b' },
  footer: { position: 'absolute' as any, bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: 8 },
});

export function AccessibilityReportPDF({
  url, overallScore, violations, wcagCriteria, screenReaderResult, visualTestResult, aiAnalysis, generatedAt,
}: AccessibilityReportPDFProps) {
  const criticalCount = violations.filter(v => v.impact === 'critical').length;
  const seriousCount = violations.filter(v => v.impact === 'serious').length;
  const moderateCount = violations.filter(v => v.impact === 'moderate').length;
  const minorCount = violations.filter(v => v.impact === 'minor').length;
  const srScore = screenReaderResult?.overallScore || 0;
  const vtScore = visualTestResult?.overallScore || 0;

  return (
    <Document>
      {/* Page 1: Executive Summary */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Accessibility Audit Report</Text>
          <Text style={styles.subtitle}>{url}</Text>
          <Text style={styles.meta}>Generated: {generatedAt} • NAT 2.0 AI Quality Engine • WCAG 2.1 Level AA</Text>
        </View>

        {/* Score Overview */}
        <View style={styles.scoreBox}>
          <View>
            <Text style={{ ...styles.scoreBig, color: overallScore >= 80 ? '#10b981' : overallScore >= 50 ? '#f59e0b' : '#ef4444' }}>
              {overallScore}/100
            </Text>
            <Text style={styles.textSmall}>Overall Score</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.text}>
              {overallScore >= 80 ? 'Good accessibility — minor improvements recommended.' :
               overallScore >= 50 ? 'Moderate issues — several areas need attention.' :
               'Significant accessibility barriers — immediate action required.'}
            </Text>
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statRow}>
          <View style={{ ...styles.statCard, borderColor: '#ef4444' }}>
            <Text style={{ ...styles.statValue, color: '#ef4444' }}>{criticalCount}</Text>
            <Text style={styles.statLabel}>Critical</Text>
          </View>
          <View style={{ ...styles.statCard, borderColor: '#f97316' }}>
            <Text style={{ ...styles.statValue, color: '#f97316' }}>{seriousCount}</Text>
            <Text style={styles.statLabel}>Serious</Text>
          </View>
          <View style={{ ...styles.statCard, borderColor: '#f59e0b' }}>
            <Text style={{ ...styles.statValue, color: '#f59e0b' }}>{moderateCount}</Text>
            <Text style={styles.statLabel}>Moderate</Text>
          </View>
          <View style={{ ...styles.statCard, borderColor: '#3b82f6' }}>
            <Text style={{ ...styles.statValue, color: '#3b82f6' }}>{minorCount}</Text>
            <Text style={styles.statLabel}>Minor</Text>
          </View>
          <View style={{ ...styles.statCard, borderColor: '#06b6d4' }}>
            <Text style={{ ...styles.statValue, color: '#06b6d4' }}>{srScore}</Text>
            <Text style={styles.statLabel}>Screen Reader</Text>
          </View>
          <View style={{ ...styles.statCard, borderColor: '#f43f5e' }}>
            <Text style={{ ...styles.statValue, color: '#f43f5e' }}>{vtScore}</Text>
            <Text style={styles.statLabel}>Visual Tests</Text>
          </View>
        </View>

        {/* WCAG Criteria */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WCAG 2.1 AA Criteria Status</Text>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellHeader}>Criterion</Text>
            <Text style={styles.tableCellHeader}>Level</Text>
            <Text style={styles.tableCellHeader}>Principle</Text>
            <Text style={styles.tableCellHeader}>Status</Text>
            <Text style={styles.tableCellHeader}>Violations</Text>
          </View>
          {(wcagCriteria || []).map((c: any, i: number) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tableCell}>{c.id}</Text>
              <Text style={styles.tableCell}>{c.level}</Text>
              <Text style={styles.tableCell}>{c.principle}</Text>
              <Text style={{ ...styles.tableCell, ...(c.status === 'pass' ? styles.passText : c.status === 'fail' ? styles.failText : styles.warnText) }}>
                {c.status === 'pass' ? '✓ Pass' : c.status === 'fail' ? '✗ Fail' : '⚠ Incomplete'}
              </Text>
              <Text style={styles.tableCell}>{c.violations || 0}</Text>
            </View>
          ))}
        </View>

        {/* AI Summary */}
        {aiAnalysis?.summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI Analysis Summary</Text>
            <Text style={styles.text}>{aiAnalysis.summary}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <Text>NAT 2.0 — AI Quality Engine</Text>
          <Text>Page 1</Text>
        </View>
      </Page>

      {/* Page 2: Violations Detail */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Accessibility Violations ({violations.length})</Text>
          {violations.slice(0, 20).map((v: any, i: number) => (
            <View key={i} style={{
              ...styles.violationRow,
              ...(v.impact === 'serious' ? styles.violationSerious :
                  v.impact === 'moderate' ? styles.violationModerate :
                  v.impact === 'minor' ? styles.violationMinor : {})
            }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{
                    ...styles.badge,
                    ...(v.impact === 'critical' ? styles.badgeCritical :
                        v.impact === 'serious' ? styles.badgeSerious :
                        v.impact === 'moderate' ? styles.badgeModerate : styles.badgeMinor)
                  }}>{v.impact?.toUpperCase()}</Text>
                  <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#1e293b' }}>{v.help || v.id}</Text>
                </View>
                <Text style={styles.textSmall}>{v.description}</Text>
                {v.nodes?.[0]?.html && (
                  <Text style={styles.code}>{v.nodes[0].html.substring(0, 120)}</Text>
                )}
              </View>
            </View>
          ))}
          {violations.length > 20 && (
            <Text style={styles.textSmall}>... and {violations.length - 20} more violations</Text>
          )}
        </View>

        {/* Screen Reader Summary */}
        {screenReaderResult && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Screen Reader Simulation</Text>
            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={{ ...styles.statValue, fontSize: 14, color: screenReaderResult.headingHierarchy?.pass ? '#10b981' : '#ef4444' }}>
                  {screenReaderResult.headingHierarchy?.pass ? '✓' : '✗'}
                </Text>
                <Text style={styles.statLabel}>Heading Hierarchy</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={{ ...styles.statValue, fontSize: 14, color: screenReaderResult.landmarks?.pass ? '#10b981' : '#ef4444' }}>
                  {screenReaderResult.landmarks?.pass ? '✓' : '✗'}
                </Text>
                <Text style={styles.statLabel}>Landmarks</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={{ ...styles.statValue, fontSize: 14, color: screenReaderResult.focusOrder?.pass ? '#10b981' : '#ef4444' }}>
                  {screenReaderResult.focusOrder?.pass ? '✓' : '✗'}
                </Text>
                <Text style={styles.statLabel}>Focus Order</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={{ ...styles.statValue, fontSize: 14, color: screenReaderResult.linksAnalysis?.pass ? '#10b981' : '#ef4444' }}>
                  {screenReaderResult.linksAnalysis?.pass ? '✓' : '✗'}
                </Text>
                <Text style={styles.statLabel}>Links ({screenReaderResult.linksAnalysis?.totalLinks || 0})</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={{ ...styles.statValue, fontSize: 14, color: screenReaderResult.ariaValidation?.pass ? '#10b981' : '#ef4444' }}>
                  {screenReaderResult.ariaValidation?.pass ? '✓' : '✗'}
                </Text>
                <Text style={styles.statLabel}>ARIA ({screenReaderResult.ariaValidation?.totalARIAElements || 0})</Text>
              </View>
            </View>
          </View>
        )}

        {/* Visual Tests Summary */}
        {visualTestResult?.tests && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Visual Accessibility Tests</Text>
            <View style={styles.tableRow}>
              <Text style={styles.tableCellHeader}>Test</Text>
              <Text style={styles.tableCellHeader}>WCAG</Text>
              <Text style={styles.tableCellHeader}>Status</Text>
              <Text style={styles.tableCellHeader}>Issues</Text>
            </View>
            {visualTestResult.tests.map((t: any, i: number) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.tableCell}>{t.testName}</Text>
                <Text style={styles.tableCell}>{t.wcagCriterion}</Text>
                <Text style={{ ...styles.tableCell, ...(t.status === 'pass' ? styles.passText : t.status === 'fail' ? styles.failText : styles.warnText) }}>
                  {t.status === 'pass' ? '✓ Pass' : t.status === 'fail' ? '✗ Fail' : '⚠ Warning'}
                </Text>
                <Text style={styles.tableCell}>{t.issues?.length || 0}</Text>
              </View>
            ))}
          </View>
        )}

        {/* AI Priority Fixes */}
        {aiAnalysis?.prioritizedIssues?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI-Recommended Priority Fixes</Text>
            {aiAnalysis.prioritizedIssues.slice(0, 5).map((issue: any, i: number) => (
              <View key={i} style={{ marginBottom: 6, padding: 6, backgroundColor: '#f8fafc', borderRadius: 3 }}>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#7c3aed', marginBottom: 2 }}>#{i + 1}: {issue.issue}</Text>
                <Text style={styles.textSmall}>{issue.remediation}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <Text>NAT 2.0 — AI Quality Engine</Text>
          <Text>Page 2</Text>
        </View>
      </Page>
    </Document>
  );
}

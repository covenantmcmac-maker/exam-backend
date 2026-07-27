import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Card, ErrorNote } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { questionsApi } from '../../api/endpoints';
import type { UploadableFile } from '../../api/client';
import { useColors } from '../../context/ThemeContext';
import { radius, spacing } from '../../theme';
import type { Colors } from '../../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BulkImport'>;

/** Formats the backend's /api/questions/bulk-upload route understands. */
const ACCEPTED_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Android often reports a null mimeType — infer it from the extension. */
const EXT_MIME: Record<string, string> = {
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const CSV_TEMPLATE = [
  'question,type,option_a,option_b,option_c,option_d,correct_answer,difficulty,subject,category,points,explanation',
  '"What is 2 + 2?",multiple-choice,3,4,5,6,B,easy,Maths,Arithmetic,2,Basic addition',
  '"The Earth orbits the Sun.",true-false,True,False,,,A,easy,Science,Astronomy,1,',
  '"Name the largest ocean.",short-answer,,,,,Pacific,medium,Geography,Oceans,2,',
].join('\n');

const JSON_TEMPLATE = JSON.stringify(
  [
    {
      question: 'What is the capital of France?',
      type: 'multiple-choice',
      option_a: 'London',
      option_b: 'Paris',
      option_c: 'Rome',
      option_d: 'Madrid',
      correct_answer: 'B',
      difficulty: 'easy',
      subject: 'Geography',
      category: 'Capitals',
      points: 1,
      explanation: 'Paris is the capital and largest city of France.',
    },
    {
      question: 'Water freezes at 0 degrees Celsius.',
      type: 'true-false',
      option_a: 'True',
      option_b: 'False',
      correct_answer: 'A',
      difficulty: 'easy',
      subject: 'Science',
      points: 1,
    },
  ],
  null,
  2
);

const COLUMN_HELP =
  'question · type (multiple-choice, true-false, short-answer, essay, fill-blank) · ' +
  'option_a … option_d · correct_answer (A–D or the answer text) · difficulty · subject · ' +
  'category · points · explanation';

interface PickedFile {
  name: string;
  size?: number;
  file: UploadableFile;
}

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BulkImportScreen({ navigation }: Props) {
  const dialog = useDialog();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateView, setTemplateView] = useState<'csv' | 'json' | null>(null);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() ?? '';
      const mime = asset.mimeType || EXT_MIME[ext] || 'application/octet-stream';

      let file: UploadableFile;
      if (Platform.OS === 'web') {
        // Browser: multipart uploads need a real File. Handing the RN-style
        // { uri, name, type } object to FormData would serialize it to
        // "[object Object]" and the upload would silently be empty.
        const blob = await (await fetch(asset.uri)).blob();
        file = new File([blob], asset.name, { type: mime });
      } else {
        // React Native: FormData wants the { uri, name, type } descriptor.
        file = { uri: asset.uri, name: asset.name, type: mime };
      }

      setPicked({ name: asset.name, size: asset.size, file });
      setError(null);
    } catch (e) {
      void dialog.notify(
        'Could not pick file',
        e instanceof Error ? e.message : 'The file picker failed to open.'
      );
    }
  };

  const upload = async () => {
    if (!picked || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const res = await questionsApi.bulkUpload(picked.file);
      setPicked(null);
      await dialog.notify(
        'Import complete',
        `${res.count} question${res.count === 1 ? '' : 's'} added to your question bank.`
      );
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = (kind: 'csv' | 'json') => {
    const text = kind === 'csv' ? CSV_TEMPLATE : JSON_TEMPLATE;
    const fileName = kind === 'csv' ? 'questions-template.csv' : 'questions-template.json';
    const mime = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';

    if (Platform.OS === 'web') {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else {
      // No browser downloads on native — show the template inline instead.
      setTemplateView((v) => (v === kind ? null : kind));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.cardTitle}>Import questions in bulk</Text>
          <Text style={styles.body}>
            Upload a file of questions and they will be added to your bank in one go.
          </Text>
          <Text style={styles.formats}>Accepted formats: CSV, Excel (.xlsx/.xls), JSON, Word (.docx/.doc)</Text>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Start from a template</Text>
          <Text style={styles.body}>
            Download a template, fill it in, then upload it here.
          </Text>
          <View style={styles.templateButtons}>
            <Button
              title="CSV template"
              variant="secondary"
              size="sm"
              style={{ flex: 1 }}
              onPress={() => downloadTemplate('csv')}
            />
            <Button
              title="JSON template"
              variant="secondary"
              size="sm"
              style={{ flex: 1 }}
              onPress={() => downloadTemplate('json')}
            />
          </View>
          {Platform.OS !== 'web' && templateView && (
            <View style={styles.templateBox}>
              <Text style={styles.templateHint}>
                Create this file on a computer, then upload it from this screen:
              </Text>
              <ScrollView horizontal>
                <Text selectable style={styles.templateText}>
                  {templateView === 'csv' ? CSV_TEMPLATE : JSON_TEMPLATE}
                </Text>
              </ScrollView>
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Upload your file</Text>
          <Button
            title={picked ? picked.name : 'Choose file…'}
            variant={picked ? 'secondary' : 'primary'}
            onPress={pickFile}
          />
          {!!picked && (
            <Text style={styles.fileMeta}>
              {formatSize(picked.size)}
              {formatSize(picked.size) ? ' · ' : ''}ready to upload
            </Text>
          )}
          <ErrorNote message={error} />
          <Button
            title="Upload"
            loading={uploading}
            disabled={!picked}
            style={{ marginTop: spacing.md }}
            onPress={upload}
          />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>CSV / Excel columns</Text>
          <Text style={styles.help}>{COLUMN_HELP}</Text>
          <Text style={styles.help}>
            Word documents use one block per question: a numbered question line, A–D option
            lines, then "Answer:", "Difficulty:", "Subject:", "Points:" and "Explanation:" lines.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
    cardTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
    body: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
    formats: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
      marginTop: spacing.md,
    },
    templateButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    templateBox: {
      marginTop: spacing.md,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    templateHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
    templateText: { fontSize: 11, color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    fileMeta: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
    help: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  });

export interface FreehireRecording {
  id: string;
  startedAt: number;
  durationSeconds: number;
  title?: string;
}

interface FreehireTargets {
  applications: { id: string; label: string; stage?: string | null }[];
  scheduled: { id: number; application: string; label: string; startsAt: string }[];
}

export type FreehireResult<T> = Promise<
  { data: T; error?: never } | { data?: never; error: string }
>;

interface AudioAccess {
  granted: boolean;
  status: string;
  error?: string;
}

interface FreehireInterviews {
  session: () => FreehireResult<boolean>;
  signIn: () => FreehireResult<boolean>;
  signOut: () => FreehireResult<boolean>;
  list: () => FreehireResult<FreehireRecording[]>;
  play: (id: string) => FreehireResult<string>;
  delete: (id: string) => FreehireResult<boolean>;
  transcribe: (id: string) => FreehireResult<string>;
  targets: (startedAt: number) => FreehireResult<FreehireTargets>;
  save: (
    id: string,
    ref: string,
    interviewId: number | undefined,
    text: string
  ) => FreehireResult<{ id: number }>;
  onSystemLevel: (callback: (rms: number) => void) => () => void;
  onSaved: (callback: (id: string) => void) => () => void;
  onRecordRequested: (callback: (title?: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: {
      getPlatform: () => string;
      checkMicrophoneAccess: () => Promise<AudioAccess>;
      requestMicrophoneAccess: () => Promise<{ granted: boolean }>;
      checkSystemAudioAccess: () => Promise<AudioAccess>;
      requestSystemAudioAccess: () => Promise<AudioAccess>;
      openMicrophoneSettings: () => Promise<{ success: boolean }>;
      openSystemAudioSettings: () => Promise<{ success: boolean }>;
      freehireInterviews: FreehireInterviews;
      startInterview: (
        title: string
      ) => FreehireResult<{ startedAt: number; systemAvailable: boolean }>;
      writeInterviewMic: (chunk: ArrayBuffer) => void;
      stopInterview: () => FreehireResult<FreehireRecording | null>;
      onInterviewError: (callback: (message: string) => void) => () => void;
      onInterviewStopped: (callback: () => void) => () => void;
      onInterviewSystemWarning: (callback: (message: string) => void) => () => void;
      onShowSettings: (callback: () => void) => () => void;
      setCallPrompts: (enabled: boolean) => Promise<{ success: boolean }>;
    };
  }
}

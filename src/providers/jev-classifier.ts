import { ProviderError } from '../domain/errors.js';
import type { RequestClassification } from '../domain/types.js';
import type { RequestClassificationInput, RequestClassifier } from '../ports/classifier.js';
import { parseRequestClassification } from '../routing/vector.js';
import { asRecord, jsonHeaders, nativeHttpClient, readJson, type HttpClient } from './http.js';
import { z } from 'zod';

const classifierVersion = 'jev-demand-v1';
const defaultMaxInputChars = 200_000;
const deepReasoningThreshold = 0.5;

const demandAxes = [
  'technicalDifficulty', 'reasoningDepth', 'creativity', 'designSkill', 'factualPrecision',
  'qualityRequirement', 'ambiguity', 'toolComplexity', 'contextComplexity', 'codingIntensity',
  'safetyStakes',
] as const;
type DemandAxis = (typeof demandAxes)[number];

interface ScoreQuestion {
  instructions: string;
  criteria: readonly [string, string, string, string, string, string, string, string, string, string];
}

const scoreQuestions: Record<DemandAxis, ScoreQuestion> = {
  technicalDifficulty: {
    instructions: 'How much specialized technical knowledge does a correct answer to this request require?',
    criteria: [
      'No technical knowledge required',
      'Everyday familiarity suffices',
      'Basic technical familiarity suffices',
      'Some professional knowledge needed',
      'Working professional knowledge required',
      'Solid professional knowledge required',
      'Advanced knowledge within one domain required',
      'Advanced specialist knowledge required',
      'Deep expertise across specialties required',
      'Expert or research-level knowledge required',
    ],
  },
  reasoningDepth: {
    instructions: 'How much reasoning must a correct answer to this request work through?',
    criteria: [
      'Direct answer, no reasoning steps',
      'A single trivial inference',
      'A single simple inference',
      'Two or three linked reasoning steps',
      'A few linked reasoning steps',
      'Several connected reasoning steps',
      'Sustained multi-step reasoning',
      'Extended multi-step reasoning',
      'Long reasoning chains with branching',
      'Deep reasoning across interacting constraints',
    ],
  },
  creativity: {
    instructions: 'How much open-ended creativity does this request demand, independent of technical or visual design skill?',
    criteria: [
      'Fully determined, no creative latitude',
      'Negligible variation allowed',
      'Minor wording or stylistic variation',
      'Limited creative choices',
      'Some creative choices within constraints',
      'Noticeable creative freedom',
      'Substantial original generation',
      'Largely original, open-ended work',
      'Highly original creation expected',
      'Highly novel, boundary-pushing creation',
    ],
  },
  designSkill: {
    instructions: 'How much visual design skill does this request demand: visual hierarchy, layout, typography, interaction patterns, and coherent design-language execution? Score independently from open-ended creativity.',
    criteria: [
      'No visual design output needed',
      'Trivial formatting only',
      'Plain formatting only',
      'Basic layout awareness needed',
      'Competent layout and styling needed',
      'Consistent, well-organized design needed',
      'Polished, coherent design execution needed',
      'Refined typography and interaction detail needed',
      'Sophisticated design-system execution needed',
      'Sophisticated, distinctive design craft needed',
    ],
  },
  factualPrecision: {
    instructions: 'How factually precise must the answer be?',
    criteria: [
      'Approximation is acceptable',
      'Broad strokes suffice',
      'Generally correct is enough',
      'Mostly accurate, loose tolerance',
      'Mostly accurate with minor tolerance for error',
      'Accurate on key facts',
      'Accurate and verifiable',
      'Precise figures and claims required',
      'Exact values and citations expected',
      'Exact, verifiable precision required',
    ],
  },
  qualityRequirement: {
    instructions: 'What is the minimum acceptable answer quality for this request?',
    criteria: [
      'Any reasonable attempt suffices',
      'A minimal response suffices',
      'Rough draft quality suffices',
      'Serviceable quality suffices',
      'A solid, usable answer is needed',
      'A good, complete answer is needed',
      'A high-quality, well-executed answer is needed',
      'Excellent quality with polish needed',
      'Near-flawless execution needed',
      'Near-perfect, production-grade output is needed',
    ],
  },
  ambiguity: {
    instructions: 'How ambiguous or underspecified is this request?',
    criteria: [
      'Fully specified with a single interpretation',
      'Almost fully specified',
      'Minor details left implicit',
      'A few gaps to infer',
      'Some underspecification',
      'Noticeable underspecification',
      'Several plausible interpretations',
      'Multiple plausible interpretations',
      'Poorly specified, requires guessing',
      'Extremely vague or contradictory',
    ],
  },
  toolComplexity: {
    instructions: 'How complex is the tool usage this request demands?',
    criteria: [
      'No tools involved',
      'At most one trivial tool call',
      'A single simple tool call',
      'One or two simple tool calls',
      'A few straightforward tool calls',
      'Several related tool calls',
      'Coordinated multi-tool usage',
      'Multi-tool usage with dependencies',
      'Chained multi-step tool usage',
      'Complex multi-step orchestration across many tools',
    ],
  },
  contextComplexity: {
    instructions: 'How much input material and contextual complexity must be handled to answer this request well?',
    criteria: [
      'A trivial, self-contained request',
      'A single simple short input',
      'A single short input with some detail',
      'A single detailed input or a few short messages',
      'A detailed input or moderate conversation history',
      'Extended input or history with several details to track',
      'Long input or multi-turn context with dependencies',
      'Long context with cross-referenced details',
      'Extensive context with interdependent details',
      'Extensive context plus structured inputs to reconcile',
    ],
  },
  codingIntensity: {
    instructions: 'How much code authoring, debugging, or code analysis does this request involve?',
    criteria: [
      'No code involved',
      'Code mentioned but not required',
      'A snippet or small edit',
      'A small self-contained snippet',
      'A function or small module',
      'A few functions or a small feature',
      'Substantial implementation or debugging',
      'Multi-file implementation or debugging',
      'Large-scale or intricate engineering',
      'Large-scale, intricate, system-level engineering',
    ],
  },
  safetyStakes: {
    instructions: 'What is the potential harm if the answer to this request is wrong?',
    criteria: [
      'No meaningful stakes',
      'Trivial consequence if wrong',
      'Minor inconvenience if wrong',
      'Small recoverable harm if wrong',
      'Moderate impact if wrong',
      'Significant but limited impact if wrong',
      'Significant financial, legal, or reputational impact if wrong',
      'Serious financial, legal, or reputational impact if wrong',
      'High-stakes professional domain: medical, legal, financial, or security',
      'Severe health, safety, security, or legal exposure if wrong',
    ],
  },
};

const deepReasoningQuestion = {
  type: 'noul',
  instructions: 'Deliberate multi-step reasoning would materially improve the correctness of the response to this request.',
  criteria: {
    true: 'The request needs step-by-step reasoning, planning, or trade-offs across constraints to be answered correctly.',
    false: 'The request can be answered correctly by direct knowledge, retrieval, or pattern completion.',
  },
} as const;

const scoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number().finite(),
  confidence: z.number().finite(),
});

const noulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().finite(),
});

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function systemOneQuestions(): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  for (const axis of demandAxes) {
    const question = scoreQuestions[axis];
    questions[axis] = { type: 'score', instructions: question.instructions, criteria: [...question.criteria] };
  }
  questions['deepReasoning'] = deepReasoningQuestion;
  return questions;
}

export interface JevClassifierOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxInputChars?: number;
  http?: HttpClient;
}

function classifierState(input: RequestClassificationInput, maxInputChars: number): Record<string, unknown> {
  const { request, deterministicFeatures } = input;
  const state = {
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    tools: request.tools?.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) ?? [],
    responseFormat: request.responseFormat?.type ?? 'text',
    stream: request.stream === true,
    requestedOutputTokens: request.maxOutputTokens ?? 1_000,
    deterministicFacts: {
      inputTokens: deterministicFeatures.inputTokens,
      messageCount: deterministicFeatures.messageCount,
      modalities: deterministicFeatures.modalities,
      hasTools: deterministicFeatures.hasTools,
      needsStructuredOutput: deterministicFeatures.needsStructuredOutput,
      needsStreaming: deterministicFeatures.needsStreaming,
    },
  };
  if (JSON.stringify(state).length > maxInputChars) throw new ProviderError(`Classifier input exceeds ${maxInputChars} characters`, false);
  return state;
}

export class JevClassifier implements RequestClassifier {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxInputChars: number;
  private readonly http: HttpClient;
  readonly name: string;

  constructor(private readonly options: JevClassifierOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.typesafe.ai').replace(/\/$/u, '');
    this.model = options.model ?? 'jev-latest';
    this.maxInputChars = options.maxInputChars ?? defaultMaxInputChars;
    if (!Number.isFinite(this.maxInputChars) || this.maxInputChars <= 0) throw new ProviderError('Classifier maxInputChars must be a positive finite number', false);
    this.http = options.http ?? nativeHttpClient;
    this.name = this.model;
  }

  async classify(input: RequestClassificationInput): Promise<RequestClassification> {
    const response = await this.http.request(`${this.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: jsonHeaders(this.options.apiKey),
      body: JSON.stringify({
        state: classifierState(input, this.maxInputChars),
        model: this.model,
        questions: systemOneQuestions(),
      }),
      signal: input.signal,
    });
    const value = await readJson(response);
    const answers = asRecord(value.answers);
    const demandVector: Record<string, unknown> = { version: 'v1' };
    let confidenceSum = 0;
    for (const axis of demandAxes) {
      const answer = scoreAnswerSchema.safeParse(answers[axis]);
      if (!answer.success) throw new ProviderError(`Jev classifier returned an invalid '${axis}' answer`, false);
      demandVector[axis] = clamp01(answer.data.score / (scoreQuestions[axis].criteria.length - 1));
      confidenceSum += clamp01(answer.data.confidence);
    }
    const reasoning = noulAnswerSchema.safeParse(answers['deepReasoning']);
    if (!reasoning.success) throw new ProviderError(`Jev classifier returned an invalid 'deepReasoning' answer`, false);
    return parseRequestClassification({
      demandVector,
      deepReasoningRequired: clamp01(reasoning.data.noul) >= deepReasoningThreshold,
      confidence: confidenceSum / demandAxes.length,
      classifierMetadata: { provider: 'typesafe', model: this.model, classifierVersion },
    });
  }
}

import type { Schema, Struct } from '@strapi/strapi';

export interface QuizAnswer extends Struct.ComponentSchema {
  collectionName: 'components_quiz_answers';
  info: {
    description: 'A single quiz answer option';
    displayName: 'Answer';
  };
  attributes: {
    isCorrect: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    text: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface QuizQuestion extends Struct.ComponentSchema {
  collectionName: 'components_quiz_questions';
  info: {
    description: 'A quiz question with its answer options';
    displayName: 'Question';
  };
  attributes: {
    answers: Schema.Attribute.Component<'quiz.answer', true> &
      Schema.Attribute.SetMinMax<
        {
          min: 2;
        },
        number
      >;
    explanation: Schema.Attribute.Text;
    question: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'quiz.answer': QuizAnswer;
      'quiz.question': QuizQuestion;
    }
  }
}

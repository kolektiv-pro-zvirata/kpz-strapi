import type { Schema, Struct } from '@strapi/strapi';

export interface LevelReward extends Struct.ComponentSchema {
  collectionName: 'components_level_rewards';
  info: {
    description: "What the user unlocks at this level. Which fields show up depends on typeOfReward, the same conditional pattern as Experience's typeOfExperience.";
    displayName: 'Reward';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'>;
    title: Schema.Attribute.String;
    typeOfReward: Schema.Attribute.Enumeration<['Video', 'Image']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'Video'>;
    video: Schema.Attribute.Media<'videos' | 'files'>;
  };
}

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

export interface RecipeNutrientItem extends Struct.ComponentSchema {
  collectionName: 'components_recipe_nutrient_items';
  info: {
    description: 'A sub-value nested under a nutrient section (e.g. "Cukry" under Sacharidy)';
    displayName: 'Nutrient Item';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    unit: Schema.Attribute.String & Schema.Attribute.DefaultTo<'g'>;
    value: Schema.Attribute.Decimal & Schema.Attribute.Required;
  };
}

export interface RecipeNutrientSection extends Struct.ComponentSchema {
  collectionName: 'components_recipe_nutrient_sections';
  info: {
    description: 'One row of the nutrition table (e.g. B\u00EDlkoviny, Sacharidy, Tuky, Vl\u00E1knina, S\u016Fl), with optional nested sub-items';
    displayName: 'Nutrient Section';
  };
  attributes: {
    color: Schema.Attribute.Enumeration<
      ['red', 'blue', 'yellow', 'green', 'purple']
    >;
    items: Schema.Attribute.Component<'recipe.nutrient-item', true>;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    unit: Schema.Attribute.String & Schema.Attribute.DefaultTo<'g'>;
    value: Schema.Attribute.Decimal & Schema.Attribute.Required;
  };
}

export interface RecipeNutrition extends Struct.ComponentSchema {
  collectionName: 'components_recipe_nutritions';
  info: {
    description: 'Recipe nutrition facts: total calories plus a dynamic list of nutrient sections. kJ is not stored \u2014 the app computes it from kcal.';
    displayName: 'Nutrition';
  };
  attributes: {
    caloriesKcal: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    sections: Schema.Attribute.Component<'recipe.nutrient-section', true>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'level.reward': LevelReward;
      'quiz.answer': QuizAnswer;
      'quiz.question': QuizQuestion;
      'recipe.nutrient-item': RecipeNutrientItem;
      'recipe.nutrient-section': RecipeNutrientSection;
      'recipe.nutrition': RecipeNutrition;
    }
  }
}

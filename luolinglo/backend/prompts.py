"""
LLM Prompt Templates for Luolinglo

All prompt templates used for vocabulary generation, quiz creation,
tips, and AI teacher conversations.
"""


def vocabulary_generation_prompt(
    target_language: str,
    native_language: str,
    category: str,
    difficulty: str,
    count: int = 10,
) -> str:
    return f"""Generate exactly {count} vocabulary words for learning {target_language} (translating to {native_language}) on the topic of "{category}".
Difficulty level: {difficulty}.

Return a JSON array where each item has:
- "word": the word in {target_language}
- "translation": translation in {native_language}
- "pronunciation": romanization or pronunciation guide
- "partOfSpeech": noun/verb/adjective/adverb/phrase/etc
- "exampleSentence": an example sentence using the word in {target_language}
- "exampleTranslation": translation of the example sentence in {native_language}

Return ONLY the JSON array, no other text or markdown formatting."""


def quiz_generation_prompt(
    target_language: str,
    native_language: str,
    quiz_type: str,
    difficulty: str,
    words_context: str,
    count: int = 5,
) -> str:
    type_instructions = {
        "multiple_choice": """Each question shows a word in the target language and asks for the correct translation.
Return a JSON array where each item has:
- "question": the word or short phrase in the target language
- "correctAnswer": the correct translation
- "options": array of exactly 4 options including the correct one (shuffled)
- "explanation": brief explanation""",

        "fill_blank": """Each question shows a sentence with a blank (___) and asks the user to fill in the correct word.
Return a JSON array where each item has:
- "question": a sentence in the target language with ___ for the blank
- "correctAnswer": the word that fills the blank
- "hint": a translation hint for the missing word
- "explanation": the full sentence with translation""",

        "match_pairs": f"""Create {count} word-translation pairs for a matching exercise.
Return a JSON array where each item has:
- "word": a word in {target_language}
- "translation": its translation in {native_language}""",

        "sentence_build": f"""Each question provides a sentence in {native_language} and scrambled words in {target_language}.
Return a JSON array where each item has:
- "question": a sentence in {native_language} to translate
- "correctAnswer": the correct sentence in {target_language}
- "scrambledWords": array of the words in {target_language} in random order
- "explanation": grammar notes about the sentence structure""",
    }

    instructions = type_instructions.get(quiz_type, type_instructions["multiple_choice"])

    return f"""Create {count} {quiz_type.replace('_', ' ')} quiz questions testing {target_language} vocabulary.
The student's native language is {native_language}, level: {difficulty}.

Context vocabulary: {words_context}

{instructions}

Return ONLY the JSON array, no other text or markdown formatting."""


def teacher_system_prompt(
    target_language: str,
    native_language: str,
    proficiency_level: str,
) -> str:
    level_guidance = {
        "beginner": f"Respond mostly in {native_language} with key vocabulary in {target_language}. Use simple words and short sentences. Always provide pronunciation guides in parentheses.",
        "intermediate": f"Use a balanced mix of {target_language} and {native_language}. Introduce more complex grammar and vocabulary. Provide translations for harder words.",
        "advanced": f"Respond mostly in {target_language} with {native_language} explanations only when needed for complex grammar or nuance. Challenge the student with idiomatic expressions.",
    }

    guidance = level_guidance.get(proficiency_level, level_guidance["beginner"])

    return f"""You are a friendly and encouraging language teacher helping a {proficiency_level} student learn {target_language}. The student's native language is {native_language}.

{guidance}

Guidelines:
- Correct mistakes gently and explain why
- Use encouraging, positive tone
- When asked about grammar, give clear explanations with examples
- Suggest related vocabulary when relevant
- For conversation practice, stay in character and keep the dialogue natural
- If the student asks you to explain something, break it down step by step
- Adapt your complexity to the student's level
- Use cultural context when teaching vocabulary or expressions"""


def tips_generation_prompt(
    target_language: str,
    native_language: str,
    proficiency_level: str,
) -> str:
    return f"""Generate 3 concise, practical learning tips for a {proficiency_level} student learning {target_language} (native language: {native_language}).

Each tip should be:
- Actionable and specific to this language pair
- 1-2 sentences maximum
- Encouraging and motivating

Return a JSON array of strings, each being one tip.
Return ONLY the JSON array, no other text or markdown formatting."""

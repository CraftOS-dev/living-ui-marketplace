import React, { useState, useEffect, useCallback } from 'react'
import { Tabs, TabList, Tab, TabPanel, Card, Button, Spinner, Badge, EmptyState } from '../ui'
import { WordTable } from './WordTable'
import { WordDetailModal } from './WordDetailModal'
import { GenerateWordsForm } from './GenerateWordsForm'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import type { VocabularyWord, VocabularyListData } from '../../types'

export function VocabularyView() {
  const [words, setWords] = useState<VocabularyWord[]>([])
  const [lists, setLists] = useState<VocabularyListData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedWord, setSelectedWord] = useState<VocabularyWord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [vocabResult, listsResult] = await Promise.all([
        ApiService.getVocabulary({ limit: 200 }),
        ApiService.getLists(),
      ])
      setWords(vocabResult.words)
      setLists(listsResult)
    } catch (err) {
      toast.error('Failed to load vocabulary data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDeleteWord = async (id: number) => {
    try {
      await ApiService.deleteWord(id)
      setWords((prev) => prev.filter((w) => w.id !== id))
      toast.success('Word deleted')
    } catch {
      toast.error('Failed to delete word')
    }
  }

  const handleAddToFlashcards = async (id: number) => {
    try {
      await ApiService.addToFlashcards(id)
      toast.success('Added to flashcards')
    } catch {
      toast.error('Failed to add to flashcards')
    }
  }

  const handleViewDetail = (word: VocabularyWord) => {
    setSelectedWord(word)
    setDetailOpen(true)
  }

  const handleDeleteList = async (id: number) => {
    try {
      await ApiService.deleteList(id)
      setLists((prev) => prev.filter((l) => l.id !== id))
      toast.success('List deleted')
    } catch {
      toast.error('Failed to delete list')
    }
  }

  const handleViewList = async (id: number) => {
    try {
      const list = await ApiService.getList(id)
      if (list.words) {
        setWords(list.words)
      }
    } catch {
      toast.error('Failed to load list')
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <Spinner size={32} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
        Vocabulary
      </h2>

      <Tabs defaultTab="all-words">
        <TabList>
          <Tab id="all-words">All Words</Tab>
          <Tab id="lists">Lists</Tab>
          <Tab id="generate">Generate</Tab>
        </TabList>

        <TabPanel id="all-words">
          <WordTable
            words={words}
            onDelete={handleDeleteWord}
            onAddToFlashcards={handleAddToFlashcards}
            onViewDetail={handleViewDetail}
          />
        </TabPanel>

        <TabPanel id="lists">
          {lists.length === 0 ? (
            <EmptyState
              message="No vocabulary lists yet. Generate words to create lists."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {lists.map((list) => (
                <Card key={list.id} padding="md">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{
                          fontSize: 'var(--font-size-base)',
                          fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
                          color: 'var(--text-primary)',
                        }}>
                          {list.name}
                        </span>
                        <Badge variant="primary" size="sm">{list.wordCount} words</Badge>
                        {list.category && <Badge variant="default" size="sm">{list.category}</Badge>}
                      </div>
                      {list.description && (
                        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                          {list.description}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <Button size="sm" variant="secondary" onClick={() => handleViewList(list.id)}>
                        View
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleDeleteList(list.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabPanel>

        <TabPanel id="generate">
          <GenerateWordsForm onGenerated={fetchData} />
        </TabPanel>
      </Tabs>

      <WordDetailModal
        word={selectedWord}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onAddToFlashcards={handleAddToFlashcards}
      />
    </div>
  )
}
